import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getConsistentMachineId } from "../shared/machineId.js";

// Server-generated item id prefixes that /responses cannot resolve when store=false.
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types executed server-side by the Grok CLI backend.
const HOSTED_TOOL_TYPES = new Set([
  "web_search",
  "x_search",
  "web_search_preview",
  "file_search",
  "image_generation",
  "code_interpreter",
  "mcp",
  "local_shell",
]);

// Fields accepted by the cli-chat-proxy Responses API (Codex allowlist + Grok extras).
const RESPONSES_API_ALLOWLIST = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "reasoning",
  "include",
  "temperature",
  "top_p",
  "max_output_tokens",
  "parallel_tool_calls",
  "text",
  "metadata",
  "prompt_cache_key",
]);

const EFFORT_LEVELS = ["low", "medium", "high"];

// Per-session last turn index so multi-turn headers never go backwards in-process.
const sessionTurnStore = new Map();

/**
 * Count user turns in a Responses `input` array.
 * Official CLI sets x-grok-turn-idx to the 1-based conversation turn (≈ user messages).
 */
export function countGrokCliUserTurns(input) {
  if (!Array.isArray(input)) return 1;
  let n = 0;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = typeof item.type === "string" ? item.type : "";
    if (item.role === "user" && (!type || type === "message")) n += 1;
  }
  return Math.max(1, n);
}

/**
 * Resolve monotonic turn index for a session. Prefers user-message count from the
 * payload but never decreases vs the last index observed for the same sessionId.
 */
export function resolveGrokCliTurnIdx(sessionId, input) {
  const fromInput = countGrokCliUserTurns(input);
  if (!sessionId) return fromInput;
  const prev = sessionTurnStore.get(sessionId) || 0;
  const turn = Math.max(fromInput, prev);
  sessionTurnStore.set(sessionId, turn);
  return turn;
}

/** Test helper — clear in-memory turn counters. */
export function _resetGrokCliTurnStore() {
  sessionTurnStore.clear();
}

function stripStoredItemReferences(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (typeof item.id === "string" && SERVER_ID_PATTERN.test(item.id)) delete item.id;
    }
    return true;
  });
}

/** Flatten Chat Completions tool shape → Responses flat format; keep hosted tools. */
function normalizeGrokCliTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";

    if (type !== "function") {
      if (HOSTED_TOOL_TYPES.has(type)) return true;
      if (!type && tool.function) {
        // fall through to function flatten below
      } else if (!type || typeof tool.name === "string") {
        // treat as bare function if name present
      } else {
        return false;
      }
    }

    const isFunction =
      type === "function" || type === "" || tool.function || typeof tool.name === "string";
    if (!isFunction || HOSTED_TOOL_TYPES.has(type)) {
      return HOSTED_TOOL_TYPES.has(type);
    }

    const fn =
      tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
        ? tool.function
        : null;
    const rawName =
      typeof tool.name === "string" ? tool.name : typeof fn?.name === "string" ? fn.name : "";
    const name = rawName.trim();
    if (!name) return false;

    const description =
      typeof tool.description === "string"
        ? tool.description
        : typeof fn?.description === "string"
          ? fn.description
          : "";
    const parameters =
      tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
        ? tool.parameters
        : fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} };

    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(name);
    return true;
  });

  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

function resolveEffortFromModel(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  for (const level of EFFORT_LEVELS) {
    if (modelId.endsWith(`-${level}`)) return level;
  }
  return null;
}

/**
 * Grok CLI Executor — OpenAI Responses API on cli-chat-proxy.grok.com.
 * Auth: OAuth device-code access token (xai-grok-cli).
 */
export class GrokCliExecutor extends BaseExecutor {
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
    this._currentSessionId = null;
    this._currentReqId = null;
    this._currentTurnIdx = 1;
    // Stable per-machine fingerprint used when a connection has no deviceId.
    // Computed lazily; never overwritten by credential-supplied ids.
    this._defaultAgentId = null;
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  // Format a machine id as the agent UUID the upstream CLI sends. The local
  // machine id is short (16 hex chars); expand it deterministically to 32 hex,
  // then slice 8-4-4-4-12 and pin version=5 / variant=a (matching upstream).
  static formatAgentId(mid) {
    if (!mid || typeof mid !== "string") return crypto.randomUUID();
    const src = mid.replace(/[^0-9a-f]/gi, "").toLowerCase();
    const hex = (src + src).padEnd(32, src).slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  // Stable per-machine agent fingerprint. getConsistentMachineId is async, so
  // resolve it here (before transformRequest/buildHeaders) with a UUID fallback.
  // Credential deviceId/agentId still win per-request in buildHeaders.
  async execute(ctx) {
    if (!this._defaultAgentId) {
      try {
        this._defaultAgentId = GrokCliExecutor.formatAgentId(await getConsistentMachineId("grok-cli-agent"));
      } catch {
        this._defaultAgentId = crypto.randomUUID();
      }
    }
    return super.execute(ctx);
  }

  // Refresh goes through the shared manager: rotation, dedup lock, merge and
  // invalid-grant classification all live there. No duplicate fetch logic here.
  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    const staticHeaders = this.config.headers || {};
    for (const [k, v] of Object.entries(staticHeaders)) {
      if (v != null && headers[k] === undefined) headers[k] = v;
    }

    headers["x-xai-token-auth"] = this.config.tokenAuth || "xai-grok-cli";
    headers["x-grok-client-identifier"] =
      this.config.clientIdentifier || headers["x-grok-client-identifier"] || "grok-pager";
    headers["x-grok-client-version"] =
      this.config.clientVersion || headers["x-grok-client-version"] || "0.2.93";
    headers["x-authenticateresponse"] = "authenticate-response";

    const sessionId = this._currentSessionId || credentials?.connectionId || crypto.randomUUID();
    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-session-id"] = sessionId;
    headers["x-grok-conv-id"] = sessionId;
    headers["x-grok-req-id"] = reqId;
    headers["x-grok-turn-idx"] = String(this._currentTurnIdx || 1);

    // Agent/device id: credential value wins per-request; else the executor's
    // stable machine fingerprint (resolved in execute()). Credential ids are
    // never persisted on the executor, so they cannot bleed across connections.
    const agentId =
      credentials?.providerSpecificData?.deviceId ||
      credentials?.providerSpecificData?.agentId ||
      this._defaultAgentId;
    if (agentId) headers["x-grok-agent-id"] = agentId;
    if (this._currentModel) headers["x-grok-model-override"] = this._currentModel;
    if (this.config.compactionAt) headers["x-compaction-at"] = String(this.config.compactionAt);

    const psd = credentials?.providerSpecificData || {};
    const email = psd.email || credentials?.email;
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (email) headers["x-email"] = email;
    if (userId) headers["x-userid"] = userId;

    return headers;
  }

  parseError(response, bodyText) {
    // 402 personal-team-blocked:spending-limit → surface as payment/quota for fallback.
    if (response.status === 402 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const code = json?.code || "";
        const msg = json?.error || json?.message || bodyText;
        return {
          status: 402,
          message: typeof msg === "string" ? msg : bodyText,
          code: typeof code === "string" ? code : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = resolveSessionId({
      headers: credentials?.rawHeaders,
      body,
      connectionId: credentials?.connectionId || credentials?.id,
      workspaceId: credentials?.providerSpecificData?.workspaceId,
      scope: "grok-cli",
    });
    this._currentReqId = crypto.randomUUID();

    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        body.input = body.messages.map((m) => ({
          type: "message",
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
        }));
        delete body.messages;
      } else {
        body.input = [{ type: "message", role: "user", content: "..." }];
      }
    }

    stripStoredItemReferences(body);
    normalizeGrokCliTools(body);

    this._currentTurnIdx = resolveGrokCliTurnIdx(this._currentSessionId, body.input);

    body.stream = true;
    body.store = false;

    // Resolve upstream model id (strip effort suffix from virtual models).
    let modelEffort = resolveEffortFromModel(body.model || model);
    let resolvedModel = body.model || model;
    if (modelEffort) {
      resolvedModel = resolvedModel.replace(new RegExp(`-${modelEffort}$`), "");
    }
    // Catalog is keyed by primary alias `gc` (see open-sse/providers/index.js).
    resolvedModel = getModelUpstreamId("gc", resolvedModel) || resolvedModel;
    body.model = resolvedModel;
    this._currentModel = resolvedModel;

    // Reasoning effort priority: explicit > reasoning_effort > model suffix > default high.
    if (!body.reasoning || typeof body.reasoning !== "object") {
      const effort = body.reasoning_effort || modelEffort || "high";
      body.reasoning = { effort, summary: "concise" };
    } else {
      if (!body.reasoning.effort) {
        body.reasoning.effort = body.reasoning_effort || modelEffort || "high";
      }
      if (!body.reasoning.summary) body.reasoning.summary = "concise";
    }
    delete body.reasoning_effort;

    // Encrypted reasoning for store=false multi-turn continuity.
    if (body.reasoning?.effort && body.reasoning.effort !== "none") {
      const include = Array.isArray(body.include) ? body.include : [];
      if (!include.includes("reasoning.encrypted_content")) {
        include.push("reasoning.encrypted_content");
      }
      body.include = include;
    }

    // Drop Chat Completions leftovers that Responses rejects.
    delete body.messages;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.n;
    delete body.seed;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logit_bias;
    delete body.user;
    delete body.stream_options;
    delete body.prompt_cache_retention;
    delete body.safety_identifier;
    delete body.previous_response_id;

    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }
}

export default GrokCliExecutor;
