import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../translator/formats/responsesApi.js";

/**
 * OpenCode Go executor (upstream #3819 + #3820 + #3800).
 *
 * Two concerns live here:
 *
 * 1. Responses transport (upstream #3819/#3820). Muse Spark contributor models
 *    are served only by /zen/go/v1/responses, so this executor pins their URL
 *    and normalizes Responses-shaped bodies (tool declarations, call_id
 *    clamping, argument/output coercion, token caps, reasoning) before they go
 *    upstream.
 *
 * 2. Stable `x-opencode-session` affinity header (upstream #3800). OpenCode Go
 *    rejects requests without a session header. `handleChatCore` forwards the
 *    provider-scoped session seed and the detected client tool on every
 *    `execute()` call (initial and credential-refresh retry alike); this
 *    executor translates them into an opaque, stable, Agent-scoped identifier
 *    (`ses_` + first 32 hex chars of SHA-256 over
 *    `opencode-go\0<clientTool|generic>\0<sessionId>`) on a request-local
 *    credentials copy, so no request state is stored on the executor singleton
 *    and shared provider credentials are never mutated.
 *
 *    Fork policy deviation from upstream: caller-supplied `x-opencode-session`
 *    headers are NEVER honored (upstream preserves a valid native header). The
 *    upstream identity is always derived from fork-resolved session identity
 *    only, keeping provider session affinity caller-proof. When chatCore
 *    context is absent, `DefaultExecutor.openCodeGoSessionHeader` remains the
 *    fallback that guarantees a header is still sent (see default.js). The
 *    design notes from upstream's docs/superpowers spec are folded into this
 *    JSDoc because the fork does not track that docs area.
 */
const RESPONSES_BASE_URL = "https://opencode.ai/zen/go/v1/responses";
const MAX_TOOL_NAME_LEN = 128;

const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_openCodeGoAgentSession";
const MAX_SESSION_LENGTH = 256;

function normalizeSession(value) {
  if (!isString(value)) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

// Translate a downstream Agent session id into an opaque, stable, Agent-scoped
// upstream identity (upstream #3800). Namespacing by clientTool isolates
// different downstream agents that reuse the same raw conversation id.
function translatedSession(sessionId, clientTool) {
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-go\0${clientTool || "generic"}\0${sessionId}`)
    .digest("hex")
    .slice(0, 32);
  return `ses_${digest}`;
}

// Strip the thinking suffix "model(level)" so checks hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  return isMuseSparkModel(baseModelId(model));
}

// Flatten Chat Completions tool declarations into the Responses flat shape and
// drop hosted/nameless tools the /responses endpoint rejects.
function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || !isObject(tool) || Array.isArray(tool)) return false;
    const fn = tool.function && isObject(tool.function) && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = isString(tool.name) ? tool.name : (isString(fn?.name) ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = isString(tool.description) ? tool.description : (isString(fn?.description) ? fn.description : "");
    let parameters = (tool.parameters && isObject(tool.parameters) && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && isObject(fn.parameters) && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    // Mirror the request translator: {type:"object"} without properties is rejected
    // by strict Responses backends, so fill in the empty properties map.
    if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && isObject(body.tool_choice) && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = isString(body.tool_choice.name) ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Last line of defense for native Responses clients (sourceFormat === targetFormat
// skips translation): coerce items in place so malformed tool payloads 400 here
// with a clear shape instead of upstream as InputValidationError.
function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || !isObject(item) || Array.isArray(item)) return true;
    if (item.type === "function_call") {
      if (!item.name || !isString(item.name) || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

export class OpenCodeGoExecutor extends DefaultExecutor {
  constructor() {
    super("opencode-go");
  }

  /**
   * Build request-local credentials carrying the translated Agent-scoped
   * session (upstream #3800). The inbound `x-opencode-session` header is
   * deliberately ignored: upstream identity derives only from the
   * chatCore-forwarded session seed, falling back to the fork session
   * resolver (explicit client session → assistant-text hash → workspace →
   * per-connection).
   */
  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const sourceCredentials = credentials || {};
    const resolved = normalizeSession(providerSessionId) || resolveSessionId({
      headers: sourceCredentials.rawHeaders,
      body,
      connectionId: sourceCredentials.connectionId,
      workspaceId: sourceCredentials.providerSpecificData?.workspaceId,
      scope: "opencode-go",
    });

    return {
      ...sourceCredentials,
      [SESSION_FIELD]: translatedSession(resolved, clientTool),
    };
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    return super.execute({ ...args, credentials });
  }

  buildHeaders(credentials, stream = true, url, model) {
    const headers = super.buildHeaders(credentials || {}, stream, url, model);
    const prepared = credentials?.[SESSION_FIELD];
    if (prepared) headers[SESSION_HEADER] = prepared;
    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Muse Spark lives on /responses even when a stale runtimeTransport leaks in.
    if (isResponsesModel(model)) return RESPONSES_BASE_URL;
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    const out = super.transformRequest(model, body, stream, credentials, requestContext);
    if (!isResponsesModel(model || body?.model)) return out;
    const normalized = normalizeResponsesInput(out.input);
    if (normalized) out.input = normalized;
    if (!Array.isArray(out.input) || out.input.length === 0) {
      out.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }
    // Responses names the output cap max_output_tokens, not max_tokens.
    if (out.max_output_tokens === undefined) {
      if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
      else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    delete out.max_completion_tokens;
    if (out.reasoning_effort !== undefined && out.reasoning === undefined) {
      out.reasoning = { effort: out.reasoning_effort, summary: "auto" };
    }
    if (out.reasoning && isObject(out.reasoning) && !Array.isArray(out.reasoning)) {
      if (!out.reasoning.summary) out.reasoning.summary = "auto";
    }
    delete out.reasoning_effort;
    out.stream = true;
    out.store = false;
    normalizeResponsesTools(out);
    sanitizeResponsesItems(out);
    return out;
  }
}
