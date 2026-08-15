// Outbound payload validation gate.
// Runs right before executor.execute() in chatCore. Catches:
//  - Required-field violations (model / messages / max_tokens / contents / input / ...)
//  - Shape violations per target format (e.g. assistant with no content AND no tool_calls,
//    gemini role outside {user, model}, malformed tool schema).
//  - Leftover internal-only underscore keys (_toolNameMap, _clientSessionId) that must
//    not leak upstream. Other underscore-prefixed keys are stripped defensively
//    but only the known ones fail validation by name.
//
// Strict by default; chatCore honors runtimeConfig.VALIDATE_OUTBOUND to disable
// the gate in an emergency (does not change which keys get stripped).
import { FORMATS } from "./formats.js";
import {
  ROLE,
  GEMINI_ROLE,
  OPENAI_BLOCK,
  CLAUDE_BLOCK,
} from "./schema/index.js";

// Internal-only keys that must NEVER be sent to an upstream provider.
// Detection of these fails validation; stripping always removes them.
export const INTERNAL_KEYS = Object.freeze([
  "_toolNameMap",
  "_clientSessionId",
  "_kiroUpstreamModel",
]);

// Keys that may legitimately start with "_" in provider payloads (none today,
// but keep a list so future additions are explicit). Anything else starting with
// "_" is treated as suspicious and stripped silently.
const ALLOWED_UNDERSCORE_KEYS = new Set();

const OPENAI_ROLES = new Set([
  ROLE.USER,
  ROLE.ASSISTANT,
  ROLE.TOOL,
  ROLE.SYSTEM,
  ROLE.DEVELOPER,
]);
const CLAUDE_ROLES = new Set([ROLE.USER, ROLE.ASSISTANT]);
const GEMINI_ROLES = new Set([GEMINI_ROLE.USER, GEMINI_ROLE.MODEL]);
const CLAUDE_BLOCK_TYPES = new Set([
  ...Object.values(CLAUDE_BLOCK),
  // Extended Claude-compatible blocks emitted by some clients / tool systems.
  "server_tool_use",
  "web_search_tool_result",
  "mcp_tool_use",
  "mcp_tool_result",
  "search_result",
  "code_execution_tool_result",
]);
const OPENAI_CONTENT_TYPES = new Set([
  OPENAI_BLOCK.TEXT,
  OPENAI_BLOCK.IMAGE_URL,
  OPENAI_BLOCK.IMAGE,
  OPENAI_BLOCK.INPUT_AUDIO,
  OPENAI_BLOCK.AUDIO_URL,
  OPENAI_BLOCK.FILE,
]);

function pushError(errors, path, message) {
  errors.push({ path, message });
}

/**
 * Coerce a tool parameters root schema whose `type` is null/missing to
 * `type: "object"`. OpenAI-compatible upstreams reject a root schema without an
 * explicit object type ("schema must be a JSON Schema of 'type: \"object\"', got
 * 'type: null'" — 9router#6359 / OmniRoute#6375); clients like the Codex app emit
 * `parameters: { type: null, ... }` for some tools. Root-only: nested null types
 * remain a separate sanitizer concern, combinator roots (anyOf/oneOf/allOf) and
 * explicit root types are preserved, and `properties:{}` is only added when
 * absent/non-object. Mutates the schema in place.
 */
function coerceRootObjectType(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const hasOwn = (k) => Object.prototype.hasOwnProperty.call(schema, k);
  // Drop a null root type first (mirroring the upstream sanitizer) so a
  // combinator root carrying `type: null` does not retain the invalid sibling.
  if (hasOwn("type") && schema.type === null) delete schema.type;
  // Explicit root type wins — leave it untouched.
  if (hasOwn("type")) return;
  // Combinator roots carry their own typing — injecting a sibling `type` would
  // change their meaning. Own-property checks, not truthiness.
  if (hasOwn("anyOf") || hasOwn("oneOf") || hasOwn("allOf")) return;
  schema.type = "object";
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    schema.properties = {};
    // Synthesizing an empty-properties object under a strict validator reads as
    // "no properties allowed"; keep it open to match the upstream sanitizer.
    if (!hasOwn("additionalProperties")) schema.additionalProperties = true;
  }
}

/**
 * Kimi/Moonshot OpenAI-compatible endpoints reject a root tool-schema
 * `anyOf` (diegosouzapw/OmniRoute 99d19f8f3, #10079) even though nested
 * combinators are fine. Strip only the tool's OWN root `anyOf` — never
 * nested `properties.*.anyOf`/`oneOf`/`allOf` roots — and only for the
 * exact source-verified Kimi-family provider ids on the OpenAI wire
 * transport. Mutates schema in place.
 */
const KIMI_ANYOF_PROVIDERS = new Set(["kimi", "kimi-coding"]);

function stripRootAnyOf(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  if (!Object.prototype.hasOwnProperty.call(schema, "anyOf")) return;
  delete schema.anyOf;
}

/**
 * Normalize root `type: null`/missing on tool function parameters before
 * dispatch, covering both OpenAI Chat Completions (`tools[].function.parameters`)
 * and OpenAI Responses flattened (`tools[].parameters`) shapes. Runs regardless
 * of the VALIDATE_OUTBOUND gate so the fix holds for passthrough
 * (source === target) requests too — the reported Codex/OpenAI-compatible case.
 * `context.provider`/`context.transportFormat` additionally gate the Kimi
 * root-`anyOf` strip (#10079) to the exact Kimi-family OpenAI transports;
 * omitted context leaves that behavior a no-op. Mutates `body` in place and
 * returns it. 9router#6359 / OmniRoute#6375.
 */
export function normalizeToolSchemaRoots(body, context = {}) {
  if (!body || typeof body !== "object" || !Array.isArray(body.tools)) return body;
  const stripAnyOf = context.transportFormat === "openai" && KIMI_ANYOF_PROVIDERS.has(context.provider);
  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object") continue;
    // Chat Completions shape: { type: "function", function: { parameters } }
    if (tool.function && typeof tool.function === "object") {
      if (stripAnyOf) stripRootAnyOf(tool.function.parameters);
      coerceRootObjectType(tool.function.parameters);
    }
    // Responses flattened shape: { type: "function", parameters }
    if (stripAnyOf) stripRootAnyOf(tool.parameters);
    coerceRootObjectType(tool.parameters);
  }
  return body;
}

// Strip known internal keys (always) and any other underscore-prefixed keys
// (silently — those don't fail validation, they just get removed).
// Mutates the body in place and returns it for convenience.
export function stripInternalKeys(body) {
  if (!body || typeof body !== "object") return body;
  // getOwnPropertyNames also catches non-enumerable metadata. Object.keys did
  // not remove legacy `_kiroUpstreamModel` hints before the executor boundary.
  for (const k of Object.getOwnPropertyNames(body)) {
    if (k.startsWith("_") && !ALLOWED_UNDERSCORE_KEYS.has(k)) {
      delete body[k];
    }
  }
  return body;
}

function validateKiro(body, errors) {
  const state = body.conversationState;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    pushError(errors, "conversationState", "Kiro conversationState object is required");
    return;
  }

  if (typeof state.conversationId !== "string" || !state.conversationId.trim()) {
    pushError(errors, "conversationState.conversationId", "Kiro conversationId string is required");
  }
  const input = state.currentMessage?.userInputMessage;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    pushError(
      errors,
      "conversationState.currentMessage.userInputMessage",
      "Kiro current userInputMessage object is required",
    );
  } else {
    if (typeof input.modelId !== "string" || !input.modelId.trim()) {
      pushError(
        errors,
        "conversationState.currentMessage.userInputMessage.modelId",
        "Kiro modelId string is required",
      );
    }
    if (typeof input.content !== "string") {
      pushError(
        errors,
        "conversationState.currentMessage.userInputMessage.content",
        "Kiro content must be a string",
      );
    }
  }

  if (!Array.isArray(state.history)) {
    pushError(errors, "conversationState.history", "Kiro history must be an array");
  } else {
    state.history.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        pushError(errors, `conversationState.history[${index}]`, "Kiro history item must be an object");
      }
    });
  }
}

// ---- Format-specific validators -------------------------------------------------

function validateOpenAI(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for openai target");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    pushError(
      errors,
      "messages",
      "messages[] is required and must be non-empty for openai target",
    );
    return;
  }
  body.messages.forEach((msg, i) => {
    const p = `messages[${i}]`;
    if (!msg || typeof msg !== "object") {
      pushError(errors, p, "message must be an object");
      return;
    }
    const m = msg;
    if (typeof m.role !== "string" || m.role.length === 0 || !OPENAI_ROLES.has(m.role)) {
      pushError(
        errors,
        `${p}.role`,
        `role must be one of ${[...OPENAI_ROLES].join("|")}`,
      );
    }
    if (m.role === ROLE.ASSISTANT) {
      // Assistant must have content or tool_calls.
      const hasContent =
        m.content !== undefined &&
        !(typeof m.content === "string" && m.content === "");
      const hasToolCalls =
        Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      if (!hasContent && !hasToolCalls) {
        pushError(
          errors,
          `${p}.content`,
          "assistant message must have content or tool_calls",
        );
      }
    } else if (m.role === ROLE.TOOL) {
      if (m.tool_call_id === null || m.tool_call_id === undefined || typeof m.tool_call_id !== "string") {
        pushError(
          errors,
          `${p}.tool_call_id`,
          "tool message requires string tool_call_id",
        );
      }
    } else {
      if (m.content === undefined) {
        pushError(
          errors,
          `${p}.content`,
          `${m.role} message requires content`,
        );
      }
    }
    // Array content block type check
    if (Array.isArray(m.content)) {
      m.content.forEach((block, j) => {
        if (!block || typeof block !== "object") return;
        const b = block;
        if (b.type && !OPENAI_CONTENT_TYPES.has(b.type)) {
          pushError(
            errors,
            `${p}.content[${j}].type`,
            `unsupported openai content type "${b.type}"`,
          );
        }
      });
    }
  });
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool, i) => {
      const p = `tools[${i}]`;
      if (!tool || typeof tool !== "object") {
        pushError(errors, p, "tool must be an object");
        return;
      }
      const t = tool;
      if (t.type === OPENAI_BLOCK.FUNCTION) {
        if (!t.function || typeof t.function !== "object") {
          pushError(
            errors,
            `${p}.function`,
            "function tool requires .function object",
          );
        } else {
          const fn = t.function;
          if (typeof fn.name !== "string" || fn.name.length === 0) {
            pushError(
              errors,
              `${p}.function.name`,
              "function tool requires .function.name string",
            );
          }
          // parameters must be a plain object (JSON Schema) — null/undefined allowed
          if (
            fn.parameters != null &&
            typeof fn.parameters !== "object"
          ) {
            pushError(
              errors,
              `${p}.function.parameters`,
              "function tool .function.parameters must be an object",
            );
          }
        }
      }
    });
  }
}

function validateClaude(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for claude target");
  }
  // max_tokens is mandatory for Anthropic Messages API.
  if (
    body.max_tokens === null ||
    body.max_tokens === undefined ||
    (typeof body.max_tokens !== "number" && typeof body.max_tokens !== "string")
  ) {
    pushError(errors, "max_tokens", "max_tokens is required for claude target");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    pushError(
      errors,
      "messages",
      "messages[] is required and must be non-empty for claude target",
    );
  } else {
    body.messages.forEach((msg, i) => {
      const p = `messages[${i}]`;
      if (!msg || typeof msg !== "object") {
        pushError(errors, p, "message must be an object");
        return;
      }
      const m = msg;
      if (typeof m.role !== "string" || m.role.length === 0 || !CLAUDE_ROLES.has(m.role)) {
        pushError(
          errors,
          `${p}.role`,
          `role must be one of ${[...CLAUDE_ROLES].join("|")}`,
        );
      }
      // content can be a string or an array of blocks
      if (Array.isArray(m.content)) {
        m.content.forEach((block, j) => {
          if (!block || typeof block !== "object") return;
          const b = block;
          if (b.type && !CLAUDE_BLOCK_TYPES.has(b.type)) {
            pushError(
              errors,
              `${p}.content[${j}].type`,
              `unsupported claude content type "${b.type}"`,
            );
          }
        });
      }
    });
  }
  // system: string OR array of {type:"text", text:string}
  if (body.system != null) {
    if (typeof body.system !== "string" && !Array.isArray(body.system)) {
      pushError(
        errors,
        "system",
        "system must be string or array of text blocks",
      );
    } else if (Array.isArray(body.system)) {
      body.system.forEach((block, i) => {
        if (
          !block ||
          typeof block !== "object" ||
          (block.type && block.type !== "text")
        ) {
          pushError(
            errors,
            `system[${i}]`,
            'system block must be {type:"text", text:string}',
          );
        }
      });
    }
  }
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool, i) => {
      const p = `tools[${i}]`;
      if (!tool || typeof tool !== "object") {
        pushError(errors, p, "tool must be an object");
        return;
      }
      const t = tool;
      if (typeof t.name !== "string" || t.name.length === 0) {
        pushError(errors, `${p}.name`, "claude tool requires .name string");
      }
      if (t.input_schema != null && typeof t.input_schema !== "object") {
        pushError(
          errors,
          `${p}.input_schema`,
          "input_schema must be an object",
        );
      }
    });
  }
}

function validateGemini(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for gemini/vertex target");
  }
  // Cloud Code envelopes (Gemini-CLI / Antigravity) nest the actual Gemini
  // payload under body.request, while model stays at the top level. Resolve
  // the payload root for contents/parts validation without mutating body.
  const root =
    body.request && typeof body.request === "object"
      ? body.request
      : body;
  const contentsPath = root === body.request ? "request.contents" : "contents";
  if (!Array.isArray(root.contents) || root.contents.length === 0) {
    pushError(
      errors,
      contentsPath,
      "contents[] is required and must be non-empty for gemini/vertex target",
    );
    return;
  }
  root.contents.forEach((msg, i) => {
    const p = `${contentsPath}[${i}]`;
    if (!msg || typeof msg !== "object") {
      pushError(errors, p, "content must be an object");
      return;
    }
    const m = msg;
    if (typeof m.role !== "string" || m.role.length === 0 || !GEMINI_ROLES.has(m.role)) {
      pushError(
        errors,
        `${p}.role`,
        `role must be one of ${[...GEMINI_ROLES].join("|")}`,
      );
    }
    if (!Array.isArray(m.parts) || m.parts.length === 0) {
      pushError(
        errors,
        `${p}.parts`,
        "gemini content requires non-empty parts[]",
      );
    }
  });
}

function validateOpenAIResponses(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for openai-responses target");
  }
  const hasInput = Array.isArray(body.input) && body.input.length > 0;
  const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
  if (!hasInput && !hasMessages) {
    pushError(
      errors,
      "input",
      "openai-responses target requires input[] or messages[]",
    );
  }
  if (body.tools != null) {
    if (!Array.isArray(body.tools)) {
      pushError(errors, "tools", "tools must be an array");
    } else {
      body.tools.forEach((tool, i) => {
        const p = `tools[${i}]`;
        if (!tool || typeof tool !== "object") {
          pushError(errors, p, "tool must be an object");
          return;
        }
        const t = tool;
        // Responses API uses a FLATTENED function tool shape:
        //   { type: "function", name, description, parameters, strict }
        // (not the Chat Completions nested { type: "function", function: {...} }).
        // The request translator emits the flattened shape, so validate for a
        // resolvable name. Tolerate a nested .function.name so no upstream path regresses.
        if (t.type === OPENAI_BLOCK.FUNCTION) {
          const name =
            (typeof t.name === "string" && t.name) ||
            (t.function && typeof t.function.name === "string" && t.function.name) ||
            "";
          if (name.trim() === "") {
            pushError(
              errors,
              `${p}.name`,
              "function tool requires a non-empty .name (Responses API flattened function tool shape)",
            );
          }
        }
      });
    }
  }
}

// Validate the translated body that is about to be dispatched upstream.
// Returns { ok, errors }. errors[] is empty on success.
// Caller is expected to short-circuit (return 400 to the client) on ok=false.
export function validateOutboundPayload(targetFormat, body) {
  const errors = [];
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      errors: [
        { path: "<root>", message: "outbound body must be a non-null object" },
      ],
    };
  }
  const b = body;
  // 1. Internal key leak detection (always fails validation by name).
  for (const k of Object.getOwnPropertyNames(b)) {
    if (INTERNAL_KEYS.includes(k)) {
      pushError(errors, k, `internal key "${k}" must not leak upstream`);
    }
  }
  // 2. Format-specific shape checks.
  switch (targetFormat) {
    case FORMATS.OPENAI:
    case FORMATS.CODEX:
    case FORMATS.OLLAMA:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      // Codex / Ollama / Cursor / Commandcode receive OpenAI-shaped bodies
      // from the translator pipeline.
      validateOpenAI(b, errors);
      break;
    case FORMATS.KIRO:
      validateKiro(b, errors);
      break;
    case FORMATS.CLAUDE:
      validateClaude(b, errors);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.ANTIGRAVITY:
    case FORMATS.VERTEX:
      validateGemini(b, errors);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
      validateOpenAIResponses(b, errors);
      break;
    default:
      // Unknown target — at least require a model so we don't dispatch an
      // empty object upstream.
      if (b.model === null || b.model === undefined) {
        pushError(errors, "model", "model is required (unknown target format)");
      }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Inbound HTTP-layer validators (OmniRoute O-A port).
//
// These run at the route boundary, BEFORE model/provider resolution, so a
// schema-invalid request fails fast with a clear OpenAI-shaped 4xx instead of
// surfacing as a misleading `model_not_found` 404 from downstream lookup. They
// are intentionally separate from `validateOutboundPayload` above (which guards
// the translated body right before the upstream dispatch). Keep both: outbound
// catches translator bugs; these catch client bugs.
//
// Source pins (TS → JS hand-translation):
//   diegosouzapw/OmniRoute#6515 (messages array guard, #6402)
//   diegosouzapw/OmniRoute#6433 (non-string model, #6407)
//   diegosouzapw/OmniRoute#6437 (scalar params, #6412 / #6424)
//   diegosouzapw/OmniRoute#6513 + #6434 (Content-Type 415, #6414)
// ---------------------------------------------------------------------------

// `Response.json` sets its own Content-Type; passing an explicit header would
// risk a duplicate/combined value on some runtimes, so the error builders below
// deliberately omit it. Only `headOkResponse` (a plain `Response`, no JSON body)
// sets `content-type` explicitly.

/**
 * Build an OpenAI-compatible error envelope.
 * @param {string} message - human-readable message (field-prefixed).
 * @param {string} type - OpenAI error type, e.g. `invalid_request_error`.
 * @param {string} [code] - machine-readable code.
 * @returns {{error: {message: string, type: string, code?: string}}}
 */
function errorEnvelope(message, type, code) {
  const error = { message, type };
  if (code) error.code = code;
  return { error };
}

/**
 * Validate the `messages` / Responses-API `input` discriminator of a chat body.
 *
 * Mirrors OmniRoute `handleChat` early guard (#6402): a present-but-non-array
 * `messages`, an empty array, or a fully-absent `messages` (when `input` is also
 * absent) must be rejected with a 400 before any routing. Responses-API
 * requests that carry `input` (no `messages`) pass through untouched.
 *
 * @param {unknown} body - parsed JSON request body (may be any value).
 * @returns {Response | null} a 400 `Response` on failure, or `null` to proceed.
 */
export function validateMessagesField(body) {
  const b = body && typeof body === "object" ? body : {};
  const hasMessages = Object.prototype.hasOwnProperty.call(b, "messages");
  const hasInput = Object.prototype.hasOwnProperty.call(b, "input");

  if (hasMessages && !Array.isArray(b.messages)) {
    return Response.json(
      errorEnvelope("messages: Expected array", "invalid_request_error"),
      { status: 400 },
    );
  }
  if (Array.isArray(b.messages) && b.messages.length === 0) {
    return Response.json(
      errorEnvelope("messages: at least one message is required", "invalid_request_error"),
      { status: 400 },
    );
  }
  if (!hasMessages && !hasInput) {
    return Response.json(
      errorEnvelope("messages: Expected array, received undefined", "invalid_request_error"),
      { status: 400 },
    );
  }
  return null;
}

/**
 * Validate the `model` field type.
 *
 * A non-string `model` (number/boolean/array/object) crashes downstream
 * `.toLowerCase()` / `.split()` lookups and escapes the error sanitizer as a
 * 500 with an empty body (#6407). `null` / `undefined` are left for the
 * existing `Missing model` guard to report; anything else that is not a string
 * is a client type error and is rejected here with a 400.
 *
 * @param {unknown} body - parsed JSON request body.
 * @returns {Response | null} a 400 `Response` on failure, or `null` to proceed.
 */
export function validateModelField(body) {
  const b = body && typeof body === "object" ? body : {};
  const raw = b.model;
  if (raw === undefined || raw === null || typeof raw === "string") return null;
  const received = Array.isArray(raw) ? "array" : typeof raw;
  return Response.json(
    errorEnvelope(`model: Expected string, received ${received}`, "invalid_request_error"),
    { status: 400 },
  );
}

/**
 * Validate widely-supported OpenAI scalar chat params.
 *
 * Runs BEFORE provider/model resolution so a malformed param (e.g.
 * `temperature: "foo"`) on an unknown model returns a 400 naming the field
 * rather than a 404 `model_not_found` (#6412). Kept narrow to the OpenAI-spec
 * params that every upstream accepts so provider-specific fields are never
 * rejected here: `temperature` (number, 0..2), `top_p` (number, 0..1),
 * `max_tokens` (integer ≥ 1), `n` (integer ≥ 1). Omitted params pass.
 *
 * @param {unknown} body - parsed JSON request body.
 * @returns {Response | null} a 400 `Response` on failure, or `null` to proceed.
 */
export function validateChatScalarParams(body) {
  const b = body && typeof body === "object" ? body : {};
  const bad = (name, msg) =>
    Response.json(errorEnvelope(`${name}: ${msg}`, "invalid_request_error"), {
      status: 400,
    });

  if (b.temperature !== undefined) {
    if (typeof b.temperature !== "number" || Number.isNaN(b.temperature)) {
      return bad("temperature", "must be a number");
    }
    if (b.temperature < 0 || b.temperature > 2) {
      return bad("temperature", "must be between 0 and 2");
    }
  }
  if (b.top_p !== undefined) {
    if (typeof b.top_p !== "number" || Number.isNaN(b.top_p)) {
      return bad("top_p", "must be a number");
    }
    if (b.top_p < 0 || b.top_p > 1) {
      return bad("top_p", "must be between 0 and 1");
    }
  }
  if (b.max_tokens !== undefined) {
    if (
      typeof b.max_tokens !== "number" ||
      !Number.isInteger(b.max_tokens) ||
      b.max_tokens < 1
    ) {
      return bad("max_tokens", "must be a positive integer");
    }
  }
  if (b.n !== undefined) {
    if (typeof b.n !== "number" || !Number.isInteger(b.n) || b.n < 1) {
      return bad("n", "must be a positive integer");
    }
  }
  return null;
}

/**
 * Content-Type guard for JSON POST/PUT/PATCH routes (#6414).
 *
 * OpenAI's reference API returns HTTP 415 `unsupported_media_type` when a POST
 * arrives with a non-JSON Content-Type (or none). Without this guard a
 * `text/plain` body is silently parsed as JSON and falls through to provider
 * lookup, surfacing as a misleading error. Only inspects the header — no body
 * read, no I/O. A `; charset=…` suffix is permitted; matching is
 * case-insensitive.
 *
 * @param {Request} request - inbound request.
 * @returns {Response | null} a 415 `Response` on rejection, or `null` to proceed.
 */
export function requireJsonContentType(request) {
  const method = String(request.method || "").toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return null;
  const raw = request.headers.get("content-type");
  const ct = (raw ?? "").trim().toLowerCase();
  if (ct.startsWith("application/json")) return null;
  return Response.json(
    errorEnvelope(
      "Content-Type must be application/json",
      "invalid_request_error",
      "unsupported_media_type",
    ),
    { status: 415 },
  );
}

/**
 * Run the full inbound-validation chain for a chat-style body.
 *
 * Order is load-bearing: scalar params and the model/messages type checks are
 * cheap pure functions and short-circuit before any async model resolution.
 * `messages` is checked first (most common client error), then `model`, then
 * scalar params — matching OmniRoute's handler order so error messages line up
 * with upstream behavior for overlapping-invalid bodies.
 *
 * @param {unknown} body - parsed JSON request body.
 * @returns {Response | null} first failing 4xx `Response`, or `null` to proceed.
 */
export function validateChatRequestBody(body) {
  return (
    validateMessagesField(body) ||
    validateModelField(body) ||
    validateChatScalarParams(body) ||
    null
  );
}

/**
 * Build the JSON 404 used by the `/v1/*` and `/api/*` catch-all routes.
 *
 * Next.js App Router falls through to `not-found.tsx` for unmatched paths and
 * returns the dashboard HTML shell — OpenAI/Anthropic SDKs crash parsing it.
 * Centralized here so both catch-alls stay byte-identical (#6405 / #6424).
 *
 * @param {Request} request - inbound request (pathname is echoed in the body).
 * @returns {Response} 404 with `error.type === "not_found"`.
 */
export function jsonNotFoundResponse(request) {
  const url = new URL(request.url);
  return Response.json(
    {
      error: {
        message: `Unknown API route: ${url.pathname}`,
        type: "not_found",
        code: "unknown_route",
        path: url.pathname,
      },
    },
    { status: 404 },
  );
}

/**
 * Explicit HEAD 200 for routes like `/v1/models` whose GET body is expensive.
 *
 * Next.js 16 auto-derives HEAD from GET and streams the full body; SDK health
 * probes then hang ~6s (#6400). Returning `{ status: 200, body: null }` closes
 * immediately per RFC 9110 §9.3.2.
 *
 * @returns {Response} 200 with a null body.
 */
export function headOkResponse() {
  return new Response(null, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * HEAD variant of the catch-all 404: identical status + JSON content-type, but
 * a null body. Returning a JSON body here would clash with the global HEAD
 * body-suppression wrapper (#6608) and violate RFC 9110 §9.3.2 (HEAD carries
 * the headers a GET would, with zero body). Tests assert status + content-type
 * only, so the envelope is intentionally not serialized.
 *
 * @returns {Response} 404 with a null body.
 */
export function headNotFoundResponse() {
  return new Response(null, {
    status: 404,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
