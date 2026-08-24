import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { errorResponse, readBoundedResponseText } from "../utils/error.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, AG_DEFAULT_TOOLS, AG_TOOL_SUFFIX } from "../config/appConstants.js";
import { dbg } from "../utils/debugLog.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { cleanJSONSchemaForAntigravity } from "../translator/formats/gemini.js";
import { DEFAULT_THINKING_AG_SIGNATURE } from "../config/defaultThinkingSignature.js";
import { isAntigravityCapacityError } from "../services/accountFallback.js";

// Sanitize function name: Gemini requires [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}
import { isObject, isString } from "@/shared/utils/typeChecks.js";function sanitizeFunctionName(name) {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

const SYSTEM_INSTRUCTION_CHAR_LIMIT = 4000;
const MAX_RETRY_AFTER_MS = 10000;
const ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS = 15000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 64000;
const ANTIGRAVITY_IDE_REQUEST_ID_RE = /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/;

const ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS = [
/high\s+traffic/i,
/agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
/capacity/i,
/temporarily\s+unavailable/i,
/timeout/i,
/stream\s+(ended|closed|terminated|interrupted)/i,
/empty\s+response/i];


const ANTIGRAVITY_TRANSIENT_STATUSES = new Set([
HTTP_STATUS.SERVER_ERROR,
HTTP_STATUS.BAD_GATEWAY,
HTTP_STATUS.SERVICE_UNAVAILABLE,
HTTP_STATUS.GATEWAY_TIMEOUT]
);

// Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields set at body root by thinkingUnified.js)
const ANTIGRAVITY_REQUEST_BLACKLIST = [
"output_config",
"thinking",
"reasoning_effort",
"reasoning",
"enable_thinking",
"thinking_budget",
"thinkingConfig"];


// Strip blacklisted fields from an object (used for both body.request and top-level body)
const stripBlacklisted = (obj) => {
  for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
};

// Compress tool schemas to reduce request body size while retaining call shape.
const MAX_SCHEMA_DEPTH = 2;
const MAX_ANTIGRAVITY_TOOL_COUNT = 40;
const MAX_TOOL_DESC_CHARS = 200;
const MAX_SCHEMA_DESC_CHARS = 150;

function compressToolSchema(schema, depth) {
  if (!schema || !isObject(schema)) return schema;

  if (depth >= MAX_SCHEMA_DEPTH) {
    if (schema.type === "object" && schema.properties) {
      const propNames = Object.keys(schema.properties);
      return {
        type: "string",
        description: schema.description ?
        `${schema.description} (JSON object with: ${propNames.join(", ")})` :
        `JSON object with properties: ${propNames.join(", ")}`
      };
    }
    if (schema.type === "array" && schema.items) {
      return { type: "array", items: { type: schema.items.type || "string" } };
    }
    return schema;
  }

  if (schema.type === "object" && schema.properties) {
    const compressed = { ...schema, properties: {} };
    for (const [key, value] of Object.entries(schema.properties)) {
      compressed.properties[key] = compressToolSchema(value, depth + 1);
    }
    if (compressed.description?.length > MAX_SCHEMA_DESC_CHARS) {
      compressed.description = compressed.description.substring(0, MAX_SCHEMA_DESC_CHARS - 3) + "...";
    }
    return compressed;
  }

  if (schema.type === "array" && schema.items) {
    return { ...schema, items: compressToolSchema(schema.items, depth + 1) };
  }

  if (schema.description?.length > MAX_SCHEMA_DESC_CHARS) {
    return { ...schema, description: schema.description.substring(0, MAX_SCHEMA_DESC_CHARS - 3) + "..." };
  }

  return schema;
}

/**
 * Repair only adjacency created by Antigravity's thought filter (#3366).
 * Translator normalization owns broader conversation policy; native passthrough must not fabricate turns.
 */
function normalizeFilteredContents(contents) {
  const normalized = [];
  for (const content of contents || []) {
    if (!content?.role || !Array.isArray(content.parts) || content.parts.length === 0) continue;
    const previous = normalized.at(-1);
    if (previous?.role === content.role) previous.parts.push(...content.parts);else
    normalized.push({ ...content, parts: [...content.parts] });
  }
  return normalized;
}

function filterThoughtParts(parts) {
  return parts?.filter((part) => {
    if (part.thought && !part.functionCall) return false;
    if (part.thoughtSignature && !part.functionCall && !part.text) return false;
    return true;
  });
}
// Image generation model name patterns
const IMAGE_MODEL_PATTERNS = [
/image/i,
/imagen/i,
/image-generation/i];


// Detect if a model is an image generation model
function isImageModel(model) {
  if (!model) return false;
  return IMAGE_MODEL_PATTERNS.some((p) => p.test(model));
}

// Parse aspect ratio / resolution from model name suffixes
// e.g. "gemini-3.1-flash-image-16x9" -> { aspectRatio: "16:9" }
// e.g. "gemini-3.1-flash-image-1024x768" -> { aspectRatio: "4:3" }
function parseImageConfig(model) {
  const config = { aspectRatio: "1:1" };
  const resMatch = model.match(/(\d+)x(\d+)$/);
  if (resMatch) {
    const w = parseInt(resMatch[1]);
    const h = parseInt(resMatch[2]);
    if (w <= 16 && h <= 16) {
      config.aspectRatio = `${w}:${h}`;
    } else {
      // Resolution like 1024x768 — derive aspect ratio
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      const d = gcd(w, h);
      config.aspectRatio = `${w / d}:${h / d}`;
    }
  }
  return config;
}

function uuidFromSeed(seed) {
  const bytes = crypto.createHash("sha256").update(String(seed || "antigravity")).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 0x0f | 0x50;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildIdeRequestId({ body, request, credentials, model, requestType }) {
  if (ANTIGRAVITY_IDE_REQUEST_ID_RE.test(body?.requestId || "")) {
    return body.requestId;
  }

  const sessionId = request?.sessionId || body?.request?.sessionId || credentials?._clientSessionId || credentials?.connectionId || credentials?.email || "anonymous";
  const conversationId = uuidFromSeed(`antigravity:conversation:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionId}:${model}:${requestType}`);
  const contentCount = Array.isArray(request?.contents) ? request.contents.length : 1;
  const step = Math.max(1, contentCount * 2 - 1);
  return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

export class AntigravityExecutor extends BaseExecutor {
  constructor(provider = "antigravity") {
    super(provider, PROVIDERS[provider] || PROVIDERS.antigravity);
  }
  async execute(options) {
    const filteredContents = options.body?.request?.contents?.map((content) => ({
      ...content,
      parts: filterThoughtParts(content?.parts)
    }));
    if (!isImageModel(options.model) && normalizeFilteredContents(filteredContents).length === 0) {
      return {
        response: errorResponse(HTTP_STATUS.BAD_REQUEST, "Antigravity request has no contents after thought filtering"),
        url: "",
        headers: {},
        transformedBody: null
      };
    }
    return super.execute(options);
  }
  buildUrl(model, stream, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    // Image generation MUST use non-streaming generateContent
    const forceNonStream = isImageModel(model);
    const action = stream && !forceNonStream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  // sessionId comes from transformRequest output; base.execute runs transformRequest before
  // buildHeaders, so we read it from instance state cached there (fallback: explicit arg).
  buildHeaders(credentials, stream = true, sessionId = null) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"]
    };
  }

  transformRequest(model, body, stream, credentials) {
    const projectId = credentials?.projectId || this.generateProjectId();

    // OpenAI clients may include stream_options even for non-streaming calls.
    // Google generateContent rejects that combination before processing the request.
    if (stream !== true) delete body.stream_options;

    // ─── Image generation: completely different request structure ───
    if (isImageModel(model)) {
      const imageConfig = parseImageConfig(model);
      // Strip model name suffixes for the actual API model name
      const cleanModel = model.replace(/-(\d+)x(\d+)$/, "");

      // Build simplified contents — text and image parts, merge all user messages
      const contents = [];
      const srcContents = body.request?.contents || body.contents || [];
      for (const c of srcContents) {
        const validParts = (c.parts || []).filter((p) => p.text !== undefined || p.inlineData !== undefined);
        if (validParts.length > 0) {
          contents.push({ role: c.role || "user", parts: validParts });
        }
      }

      const sessionId = resolveSessionId({
        headers: credentials?.rawHeaders,
        body,
        connectionId: credentials?.email || credentials?.connectionId,
        scope: "antigravity"
      });

      this._lastSessionId = sessionId;
      const request = {
        contents,
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          imageConfig
        },
        sessionId
        // No tools, no systemInstruction, no safetySettings for image gen
      };

      return {
        project: projectId,
        model: cleanModel,
        userAgent: "antigravity",
        requestType: "image_gen",
        requestId: buildIdeRequestId({ body, request, credentials, model: cleanModel, requestType: "image_gen" }),
        request
      };
    }

    // ─── Standard (non-image) request ───
    // Fix contents for Claude models via Antigravity
    /**
     * Normalize only turns emptied by thought filtering; Antigravity rejects empty parts and adjacent roles.
     * Ported from upstream decolua/9router#3366 without importing translator continuation policy.
     */
    const contents = normalizeFilteredContents(body.request?.contents?.map((c) => {
      let role = c.role;
      // functionResponse must be role "user" for Claude models
      if (c.parts?.some((p) => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = filterThoughtParts(c.parts);
      // Gemini 3+ rejects functionCall parts without thoughtSignature. Clients (Claude Code, IDE)
      // don't persist thoughtSignature in their history, so backfill the default signature on any
      // functionCall part that arrives without one.
      const needsBackfill = parts?.some((p) => p.functionCall && !p.thoughtSignature) ?? false;
      if (role !== c.role || parts?.length !== c.parts?.length || needsBackfill) {
        return {
          ...c, role,
          parts: needsBackfill ?
          parts.map((p) => p.functionCall && !p.thoughtSignature ?
          { ...p, thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE } :
          p) :
          parts
        };
      }
      return c;
    }));

    // Sanitize tool schemas and function names before sending to Antigravity.
    let tools = body.request?.tools;

    if (tools && tools.length > 0) {
      // Merge all groups into a single functionDeclarations group (Gemini expects 1 group)
      const seenToolNames = new Set();
      const allDeclarations = [];
      for (const group of tools) {
        for (const fn of group.functionDeclarations || []) {
          const name = sanitizeFunctionName(fn.name);
          if (seenToolNames.has(name)) continue;
          seenToolNames.add(name);
          let cleanedParams;
          try {
            cleanedParams = fn.parameters ?
            cleanJSONSchemaForAntigravity(structuredClone(fn.parameters)) :
            { type: "object", properties: { reason: { type: "string", description: "Brief explanation" } }, required: ["reason"] };
          } catch (schemaErr) {
            console.warn(`[9Router] Schema conversion failed for tool "${name}": ${schemaErr.message}. Using fallback schema.`);
            const safeProperties = Object.fromEntries(
              Object.entries(fn.parameters?.properties || {}).map(([key, value]) => [key, { type: isString(value?.type) ? value.type : "string", description: value?.description || "" }])
            );
            if (Object.keys(safeProperties).length === 0) safeProperties.reason = { type: "string", description: "Brief explanation" };
            cleanedParams = {
              type: "object",
              properties: safeProperties,
              required: (fn.parameters?.required || []).filter((required) => safeProperties[required])
            };
          }
          cleanedParams = compressToolSchema(cleanedParams, 0);
          allDeclarations.push({
            ...fn,
            name,
            description: fn.description ? fn.description.substring(0, MAX_TOOL_DESC_CHARS) : "",
            parameters: cleanedParams
          });
        }
      }

      if (allDeclarations.length > MAX_ANTIGRAVITY_TOOL_COUNT) {
        const native = [];
        const custom = [];
        for (const declaration of allDeclarations) {
          (AG_DEFAULT_TOOLS.has(declaration.name) ? native : custom).push(declaration);
        }
        const remaining = MAX_ANTIGRAVITY_TOOL_COUNT - native.length;
        const pruned = [...native, ...custom.slice(0, Math.max(0, remaining))];
        dbg("TOOLS", `Pruned ${allDeclarations.length} → ${pruned.length} tools for Antigravity (${native.length} native + ${Math.min(custom.length, remaining)} client)`);
        allDeclarations.length = 0;
        allDeclarations.push(...pruned);
      }

      const bodyEstimate = JSON.stringify(allDeclarations).length;
      dbg("TOOLS", `Processed ${allDeclarations.length} tool declarations for Antigravity (~${Math.round(bodyEstimate / 1024)}KB): [${Array.from(seenToolNames).slice(0, 10).join(", ")}${seenToolNames.size > 10 ? "..." : ""}]`);
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : [];
    }

    // Strip contents/tools/toolConfig (handled separately) and blacklisted fields that Google rejects
    const { contents: _originalContents, tools: _originalTools, toolConfig: _originalToolConfig, ...requestWithoutTools } = body.request || {};
    stripBlacklisted(requestWithoutTools);

    // Rewrite competitive system prompts (e.g. Zed IDE's Claude SDK marker) to prevent
    // Antigravity from flagging the request and immediately blocking it with a 429 Quota
    // Exhausted response. Narrow, exact-string match only (upstream decolua/9router#3223) —
    // see docs/campaigns/upstream-3223-antigravity-prompt-ledger.md for why this stays narrow.
    if (requestWithoutTools.systemInstruction?.parts) {
      const competitiveMarker = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
      for (const part of requestWithoutTools.systemInstruction.parts) {
        if (isString(part.text) && part.text.includes(competitiveMarker)) {
          part.text = part.text.split(competitiveMarker).join("");
        }
      }
    }
    const generationConfig = { ...(requestWithoutTools.generationConfig || {}) };
    if (generationConfig.maxOutputTokens > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }

    const transformedRequest = {
      ...requestWithoutTools,
      generationConfig,
      ...(contents.length > 0 && { contents }),
      ...(tools && { tools }),
      sessionId: body.request?.sessionId || resolveSessionId({ headers: credentials?.rawHeaders, body, connectionId: credentials?.email || credentials?.connectionId, scope: "antigravity" }),
      safetySettings: undefined,
      ...(tools?.length > 0 && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } })
    };

    // Large system prompts exhaust the systemInstruction limit; preserve them in user content.
    const sysInstr = transformedRequest.systemInstruction;
    if (sysInstr) {
      const sysText = sysInstr.parts?.map((part) => part.text || "").join("") || "";
      if (sysText.length > SYSTEM_INSTRUCTION_CHAR_LIMIT) {
        const requestContents = transformedRequest.contents || [];
        const firstUserIndex = requestContents.findIndex((content) => content.role === "user");
        if (firstUserIndex >= 0) {
          const firstUser = requestContents[firstUserIndex];
          const existingText = firstUser.parts?.filter((part) => part.text !== undefined).map((part) => part.text).join("") || "";
          const otherParts = firstUser.parts?.filter((part) => part.text === undefined) || [];
          requestContents[firstUserIndex] = {
            ...firstUser,
            parts: [{ text: `[System Instructions]\n${sysText}\n\n[User Message]\n${existingText}` }, ...otherParts]
          };
        } else {
          requestContents.unshift({ role: "user", parts: [{ text: sysText }] });
        }
        transformedRequest.contents = requestContents;
        delete transformedRequest.systemInstruction;
        dbg("TOOLS", `Embedded ${sysText.length} char system prompt into user content (exceeds ${SYSTEM_INSTRUCTION_CHAR_LIMIT} limit)`);
      }
    }

    // Strip blacklisted thinking fields from top-level body (set by thinkingUnified.js at root, not body.request)
    stripBlacklisted(body);

    this._lastSessionId = transformedRequest.sessionId; // cached for buildHeaders (base.execute order)

    return {
      ...body,
      project: projectId,
      model: model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: buildIdeRequestId({ body, request: transformedRequest, credentials, model, requestType: "agent" }),
      request: transformedRequest
    };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      }, proxyOptions);

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateProjectId() {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId() {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers) {
    if (!headers?.get) return null;

    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get('x-ratelimit-reset');
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(errorMessage) {
    if (!errorMessage || !isString(errorMessage)) return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  extractErrorMessage(errorJson, bodyText = "") {
    return [
    errorJson?.error?.message,
    errorJson?.message,
    errorJson?.error,
    bodyText].
    filter(Boolean).map((v) => isString(v) ? v : JSON.stringify(v)).join("\n");
  }

  isTransientAntigravityError(status, message) {
    if (status === HTTP_STATUS.RATE_LIMITED) return true;
    if (ANTIGRAVITY_TRANSIENT_STATUSES.has(status)) return true;
    return ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message || ""));
  }

  // Hook called by BaseExecutor.tryRetry: derive delay from Retry-After (header → body),
  // cap at MAX_RETRY_AFTER_MS, else retry transient Antigravity failures with backoff.
  // Return false to veto (fallback URL / final error).
  async computeRetryDelay(response, attempt, _defaultDelayMs, readOptions = {}) {
    let bodyText = "";
    let errorJson = null;
    let retryMs = this.parseRetryHeaders(response.headers);

    try {
      bodyText = await readBoundedResponseText(response.clone(), readOptions);
      errorJson = bodyText ? JSON.parse(bodyText) : null;
    } catch (error) {
      if (error?.name === "AbortError" || readOptions?.signal?.aborted) throw error;
      // ignore parse errors → fall through to status/message based retry
    }

    const errorMessage = this.extractErrorMessage(errorJson, bodyText);

    if (isAntigravityCapacityError(response.status, errorMessage)) return false;

    if (!retryMs) {
      retryMs = this.parseRetryFromErrorMessage(errorMessage);
    }
    if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : false;

    if (!this.isTransientAntigravityError(response.status, errorMessage)) return false;

    const cap = response.status === HTTP_STATUS.RATE_LIMITED ?
    MAX_RETRY_AFTER_MS :
    ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS;
    return Math.min(1000 * 2 ** attempt, cap); // exponential backoff
  }

  /**
   * Cloak tools before sending to Antigravity provider (anti-ban):
   * - Rename client tools with _ide suffix
   * - Inject AG default decoy tools after client tools
   * Returns { cloakedBody, toolNameMap } where toolNameMap maps suffixed → original
   */
  static cloakTools(body, clientTool = null) {
    const tools = body.request?.tools;
    if (!tools || tools.length === 0) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const isCopilot = clientTool === "github-copilot";
    const toolNameMap = new Map();
    const clientDeclarations = [];
    const decoyNames = new Set(AG_DECOY_TOOLS.map((tool) => tool.name));

    // First: collect renamed client tools
    for (const toolGroup of tools) {
      if (!toolGroup.functionDeclarations) continue;

      for (const func of toolGroup.functionDeclarations) {
        // For GitHub Copilot, avoid emitting duplicate native Antigravity tool names.
        // Keep the decoys only once in the final declaration list.
        if (isCopilot && AG_DEFAULT_TOOLS.has(func.name)) {
          continue;
        }

        // Skip if already covered by decoys for Copilot
        if (isCopilot && decoyNames.has(func.name)) {
          continue;
        }

        // Preserve native AG names for non-Copilot clients
        if (AG_DEFAULT_TOOLS.has(func.name)) {
          clientDeclarations.push(func);
          continue;
        }

        const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
        toolNameMap.set(suffixed, func.name);
        clientDeclarations.push({ ...func, name: suffixed });
      }
    }

    // Client tools first, then AG decoy tools
    const allDeclarations = [];
    const seenNames = new Set();
    for (const decl of [...clientDeclarations, ...AG_DECOY_TOOLS]) {
      if (!decl?.name || seenNames.has(decl.name)) continue;
      seenNames.add(decl.name);
      allDeclarations.push(decl);
    }

    // Rename tool names in conversation history (contents)
    const cloakedContents = body.request?.contents?.map((msg) => {
      if (!msg.parts) return msg;

      const cloakedParts = msg.parts.map((part) => {
        // Rename functionCall.name
        if (part.functionCall && !AG_DEFAULT_TOOLS.has(part.functionCall.name)) {
          return {
            ...part,
            functionCall: {
              ...part.functionCall,
              name: `${part.functionCall.name}${AG_TOOL_SUFFIX}`
            }
          };
        }

        // Rename functionResponse.name
        if (part.functionResponse && !AG_DEFAULT_TOOLS.has(part.functionResponse.name)) {
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              name: `${part.functionResponse.name}${AG_TOOL_SUFFIX}`
            }
          };
        }

        return part;
      });

      return { ...msg, parts: cloakedParts };
    });

    // Single functionDeclarations group: client tools first, then decoys
    return {
      cloakedBody: {
        ...body,
        request: {
          ...body.request,
          tools: [{ functionDeclarations: allDeclarations }],
          contents: cloakedContents || body.request.contents
        }
      },
      toolNameMap
    };
  }

  /**
   * Parse Antigravity quota-exhausted errors to extract precise reset time.
   * AG returns quotaResetDelay ("160h19m55s") or quotaResetTimeStamp (ISO string)
   * in error.details[].metadata. We surface this as resetsAtMs so markAccountUnavailable
   * can lock the account for the real duration instead of the MAX_RATE_LIMIT_COOLDOWN_MS cap.
   * When a secondary account is available this precise cooldown lets the router fall over
   * to it for the full quota window rather than retrying the exhausted primary.
   *
   * @param {Response} response - Upstream response
   * @param {string} bodyText - Raw response body
   * @returns {{status: number, message: string, resetsAtMs?: number}}
   */
  parseError(response, bodyText) {
    if (response.status !== 429) return super.parseError(response, bodyText);

    try {
      const errorJson = JSON.parse(bodyText);
      const details = errorJson?.error?.details || [];

      for (const detail of details) {
        const meta = detail?.metadata || {};

        // quotaResetTimeStamp: ISO string — most precise
        if (meta.quotaResetTimeStamp) {
          const ms = new Date(meta.quotaResetTimeStamp).getTime();
          if (ms > Date.now()) {
            return {
              status: 429,
              message: errorJson?.error?.message || bodyText,
              resetsAtMs: ms
            };
          }
        }

        // quotaResetDelay: duration string e.g. "160h19m55s"
        if (meta.quotaResetDelay) {
          const match = meta.quotaResetDelay.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/);
          if (match) {
            const h = parseFloat(match[1] || 0);
            const m = parseFloat(match[2] || 0);
            const s = parseFloat(match[3] || 0);
            const delayMs = (h * 3600 + m * 60 + s) * 1000;
            if (delayMs > 0) {
              return {
                status: 429,
                message: errorJson?.error?.message || bodyText,
                resetsAtMs: Date.now() + delayMs
              };
            }
          }
        }
      }
    } catch {

      // fall through to base
    }
    return super.parseError(response, bodyText);
  }
}

// AG decoy tools — same names as AG native defaults, redirect to _ide suffixed tools
const AG_DECOY_TOOLS = [
{
  name: "browser_subagent",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "command_status",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "find_by_name",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "generate_image",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "grep_search",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "list_dir",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "list_resources",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "mcp_sequential-thinking_sequentialthinking",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "multi_replace_file_content",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "notify_user",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "read_resource",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "read_terminal",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "read_url_content",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "replace_file_content",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "run_command",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "search_web",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "send_command_input",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "task_boundary",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "view_content_chunk",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "view_file",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "write_to_file",
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
}];


export default AntigravityExecutor;