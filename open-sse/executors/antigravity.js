import { renameGeminiProperties } from "../translator/concerns/geminiPlaceholderArgs.js";
import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { errorResponse, readBoundedResponseText } from "../utils/error.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, AG_DEFAULT_TOOLS, AG_TOOL_SUFFIX, ANTIGRAVITY_HERMES_IDENTITY_REWRITE, ANTIGRAVITY_BILLING_HEADER_RE, ANTIGRAVITY_PROMPT_REWRITES, ANTIGRAVITY_TELEMETRY_KEYS, ANTIGRAVITY_DEFAULT_SYSTEM } from "../config/appConstants.js";
import { GEMINI_ROLE } from "../translator/schema/roles.js";
import { dbg } from "../utils/debugLog.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { applyGemini4RequestRules, cleanJSONSchemaForAntigravity, sanitizeFunctionResponseResult } from "../translator/formats/gemini.js";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../config/defaultThinkingSignature.js";
import { antigravityCatalogUserAgent } from "../services/antigravityCatalog.js";
import { isAntigravityCapacityError } from "../services/accountFallback.js";
import { createGeminiToolNameAliaser } from "../translator/concerns/toolCall.js";
import { normalizeToolSchema } from "../translator/concerns/toolSchema.js";
import { isObject, isString, isNumber } from "../../src/shared/utils/typeChecks.js";
import { getGeminiThoughtSignatureSync, signatureFamily } from "../services/thoughtSignatureStore.js";

// Native provider declarations bypass the shared OpenAI tool-schema normalization.
// Visit only surviving schema nodes, never the property-name maps themselves.
function normalizeAntigravityBounds(node) {
  if (!node || !isObject(node) || Array.isArray(node)) return;
  for (const key of ["minimum", "maximum", "minProperties", "maxProperties"]) {
    if (!isString(node[key])) continue;
    const value = normalizeToolSchema({ [key]: node[key] })[key];
    if (Number.isFinite(value) && (!key.endsWith("Properties") || Number.isInteger(value) && value >= 0)) node[key] = value;
  }
  if (node.properties && isObject(node.properties) && !Array.isArray(node.properties)) {
    for (const child of Object.values(node.properties)) normalizeAntigravityBounds(child);
  }
  normalizeAntigravityBounds(node.items);
}

/**
 * Preserve common OpenCode casing while rewriting branding at the Antigravity boundary.
 *
 * @param {unknown} text - Antigravity system-instruction text.
 * @returns {unknown} Rewritten text, or the original non-string value.
 */
function rewriteOpenCodeBranding(text) {
  if (!isString(text)) return text;
  return text.replace(ANTIGRAVITY_PROMPT_REWRITES[0].from, ANTIGRAVITY_PROMPT_REWRITES[0].to);
}

function stripHarnessTelemetry(value) {
  if (!isObject(value) || value === null || Array.isArray(value)) return value;
  const cleaned = { ...value };
  for (const key of ANTIGRAVITY_TELEMETRY_KEYS) delete cleaned[key];
  if (isObject(cleaned.labels) && cleaned.labels !== null && !Array.isArray(cleaned.labels)) {
    const labels = { ...cleaned.labels };
    for (const key of ANTIGRAVITY_TELEMETRY_KEYS) delete labels[key];
    cleaned.labels = labels;
  }
  return cleaned;
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

// Preserve conflicting branches so responses retain their structured arguments.
function hasPropertiesParameter(schema) {
  if (!schema || !isObject(schema)) return false;
  if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, "properties")) return true;
  return Object.values(schema.properties || {}).some(hasPropertiesParameter) || hasPropertiesParameter(schema.items);
}

function compressToolSchema(schema, depth) {
  if (!schema || !isObject(schema)) return schema;

  if (depth >= MAX_SCHEMA_DEPTH && !hasPropertiesParameter(schema)) {
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

/**
 * Remove Antigravity-invalid blank text after thought stripping. Deliberately
 * leaves no fallback: normalizeFilteredContents preserves caller semantics.
 */
function filterThoughtParts(parts) {
  return parts?.filter((part) => {
    if (part.thought && !part.functionCall) return false;
    if (part.thoughtSignature && !part.functionCall && !part.text) return false;
    if (isString(part.text) && part.text.trim() === "") return false;
    return true;
  });
}

// Cloud Code expects proto-JSON camelCase media keys, including nested tool results.
function normalizeMediaParts(parts) {
  if (!Array.isArray(parts)) return parts;
  return parts.map((part) => {
    if (!part || !isObject(part)) return part;
    const result = { ...part };
    for (const [snake, camel] of [["inline_data", "inlineData"], ["file_data", "fileData"]]) {
      const media = result[camel] ?? result[snake];
      delete result[snake];
      if (media !== undefined) result[camel] = media;
      if (!media || !isObject(media)) continue;
      result[camel] = { ...media };
      for (const [oldKey, newKey] of [["mime_type", "mimeType"], ["file_uri", "fileUri"]]) {
        if (result[camel][newKey] === undefined && result[camel][oldKey] !== undefined) result[camel][newKey] = result[camel][oldKey];
        delete result[camel][oldKey];
      }
    }
    if (result.functionResponse?.parts) result.functionResponse = { ...result.functionResponse, parts: normalizeMediaParts(result.functionResponse.parts) };
    return result;
  });
}

// FNV-1a with signed 64-bit formatting matches the Hub session wire format.
function antigravitySessionId(body, credentials) {
  const incoming = body.request?.sessionId;
  const account = String(credentials?.connectionId || "").trim();
  if (incoming != null && String(incoming).trim() && !account) return String(incoming).trim();
  const identity = credentials?._clientSessionId || incoming || resolveSessionId({
    headers: credentials?.rawHeaders, body, connectionId: account || credentials?.email, scope: "antigravity"
  });
  const child = credentials?._antigravitySubagentId || body.metadata?.subagent_id || body.metadata?.agent_id || body.subagent_id || credentials?.rawHeaders?.["x-subagent-id"] || "";
  const escapeAgentDelimiter = (value) => String(value).replaceAll("%", "%25").replaceAll(":agent:", "%3Aagent%3A");
  const scopedIdentity = child ? `${escapeAgentDelimiter(identity)}:agent:${escapeAgentDelimiter(child)}` : escapeAgentDelimiter(identity);
  const input = [scopedIdentity, account, "explicit-session", "antigravity", "cli-proxy-api"].join("\0");
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(input)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return BigInt.asIntN(64, hash).toString();
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

// Port of upstream decolua/9router #5809. Antigravity refuses some requests (for example a system
// prompt carrying fingerprinted third-party agent text) with a bare gRPC RESOURCE_EXHAUSTED: a fixed
// message and no details. Real quota errors carry ErrorInfo/RetryInfo/reset metadata. The bare form
// repeats for the same body, so it is request-scoped: retrying, refreshing quota or locking the
// account cannot help.
const ANTIGRAVITY_BARE_EXHAUSTED_MESSAGE = /^Resource has been exhausted \(e\.g\. check quota\)\.?$/;
export const ANTIGRAVITY_PROMPT_REJECTED_MESSAGE = "Antigravity rejected this request (upstream 429 RESOURCE_EXHAUSTED with no quota details, so this is not your quota). " +
"Antigravity refuses system prompts that carry certain third-party agent text. DurinDoor rewrites the known strings " +
"(ANTIGRAVITY_PROMPT_REWRITES) and retries a refused prompt once with the system text moved into the first user turn, " +
"but this request was still refused.";

export function isAntigravityPromptRejection(status, bodyText) {
  if (status !== HTTP_STATUS.RATE_LIMITED || !bodyText) return false;
  let err;
  try {err = JSON.parse(bodyText)?.error;} catch {return false;}
  if (err?.status !== "RESOURCE_EXHAUSTED") return false;
  if (!ANTIGRAVITY_BARE_EXHAUSTED_MESSAGE.test(String(err.message || "").trim())) return false;
  return !(Array.isArray(err.details) && err.details.length > 0);
}

// Antigravity fingerprints systemInstruction only: the same text in a user turn passes. Returns a
// copy of the envelope with the system text moved to the front of the contents, or null when there
// is no system text to move.
export function moveSystemInstructionToContents(body) {
  const { systemInstruction, ...request } = body?.request || {};
  const parts = (systemInstruction?.parts || []).filter((p) => isString(p?.text) && p.text.trim());
  if (parts.length === 0) return null;
  return { ...body, request: { ...request, contents: [{ role: "user", parts }, ...(request.contents || [])] } };
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
    const result = await super.execute(options);
    // A bare detail-free 429 means systemInstruction carries text Google fingerprints that the rewrite
    // list does not cover yet. Retry once with that text moved into the first user turn. Image models
    // never send systemInstruction, so there is nothing to move.
    if (result?.response?.status === HTTP_STATUS.RATE_LIMITED && !isImageModel(options.model)) {
      const moved = moveSystemInstructionToContents(options.body);
      if (moved) {
        let bodyText = "";
        try {
          bodyText = await readBoundedResponseText(result.response.clone(), { signal: options.signal });
        } catch (error) {
          if (error?.name === "AbortError" || options.signal?.aborted) throw error;
        }
        if (isAntigravityPromptRejection(result.response.status, bodyText)) {
          options.log?.warn?.("ANTIGRAVITY", "System prompt rejected (fingerprinted text not in ANTIGRAVITY_PROMPT_REWRITES); retrying with it in the first user turn");
          return super.execute({ ...options, body: moved });
        }
      }
    }
    return result;
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
      "User-Agent": antigravityCatalogUserAgent(credentials, this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"])
    };
  }

  transformRequest(model, body, stream, credentials) {
    body = { ...(body || {}) };
    if (body.request) {
      body.request = { ...body.request };
      if (body.request.systemInstruction?.parts) {
        body.request.systemInstruction = {
          ...body.request.systemInstruction,
          parts: normalizeMediaParts(body.request.systemInstruction.parts).map((part) =>
            isObject(part) && part !== null && !Array.isArray(part) ? { ...part } : part
          )
        };
      }
    }
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
        // Keep text and inline image parts; normalize snake_case inline_data (#4724).
        const validParts = normalizeMediaParts(c.parts || []).
        filter((p) => p.text !== undefined || p.inlineData !== undefined || p.inline_data !== undefined).
        map((p) => {
          const inline = p.inlineData || p.inline_data;
          return inline ? { inlineData: inline } : p;
        });
        if (validParts.length > 0) {
          contents.push({ role: c.role || "user", parts: validParts });
        }
      }

      const sessionId = (body.request?.sessionId || credentials?._clientSessionId) && !credentials?._clientSessionIsGenerated
        ? antigravitySessionId(body, credentials) : undefined;

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

    const sessionId = antigravitySessionId(body, credentials);

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
      const parts = normalizeMediaParts(filterThoughtParts(c.parts));
      // Gemini 3+ rejects functionCall parts without thoughtSignature. Clients (Claude Code, IDE)
      // don't persist thoughtSignature in their history, so backfill from cache or default signature.
      // In parallel function calls, only the first call needs a signature; siblings stay unsigned.
      let firstFunctionCallSeen = false;
      const targetModel = body.model || model;
      const defaultSignature = signatureFamily(targetModel) === "claude"
        ? DEFAULT_THINKING_AG_SIGNATURE
        : DEFAULT_THINKING_GEMINI_CLI_SIGNATURE;
      const modifiedParts = parts?.map(p => {
        // Native requests bypass the translator's function-response payload sanitizer.
        if (p.functionResponse) {
          return {
            ...p,
            functionResponse: {
              ...p.functionResponse,
              response: sanitizeFunctionResponseResult(p.functionResponse.response)
            }
          };
        }
        if (!p.functionCall) return p;
        const callId = p.functionCall.id;
        const cachedSig = callId ? getGeminiThoughtSignatureSync(callId, sessionId, targetModel) : null;
        const callSig = p.thoughtSignature || cachedSig || (!firstFunctionCallSeen ? defaultSignature : undefined);
        firstFunctionCallSeen = true;
        if (callSig) {
          return { ...p, thoughtSignature: callSig };
        }
        if (p.thoughtSignature && !cachedSig) {
          // Unsigned sibling call
          const { thoughtSignature: _, ...rest } = p;
          return rest;
        }
        return p;
      });

      const partsChanged = parts?.length !== c.parts?.length || modifiedParts?.some((p, idx) => p !== c.parts[idx]);
      if (role !== c.role || partsChanged) {
        return {
          ...c, role,
          parts: modifiedParts || parts,
        };
      }
      return c;
    }));

    // Native requests bypass the translator's response schema normalization.
    if (body.request?.generationConfig?.responseSchema) {
      body.request.generationConfig.responseSchema = cleanJSONSchemaForAntigravity(
        structuredClone(body.request.generationConfig.responseSchema), { preserveNullable: true }
      );
    }

    // Sanitize tool schemas and function names before sending to Antigravity.
    let tools = body.request?.tools;
    const { alias: sanitizeFunctionName, aliases: toolNameMap } = createGeminiToolNameAliaser();

    const isSearch = body.requestType === "web_search" && tools?.length === 1 && tools[0]?.googleSearch;
    if (tools && tools.length > 0 && !isSearch) {
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
          normalizeAntigravityBounds(cleanedParams);
          cleanedParams = compressToolSchema(cleanedParams, 0);
          renameGeminiProperties(cleanedParams);
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
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : tools
        .map((group) => ({ ...(group.codeExecution && { codeExecution: group.codeExecution }), ...(group.urlContext && { urlContext: group.urlContext }) }))
        .filter((group) => Object.keys(group).length > 0);
    }
    for (const content of contents || []) {
      for (const part of content.parts || []) {
        if (part.functionCall?.name) part.functionCall.name = sanitizeFunctionName(part.functionCall.name);
        if (part.functionResponse?.name) part.functionResponse.name = sanitizeFunctionName(part.functionResponse.name);
      }
    }

    const rawToolConfig = body.request?.toolConfig || body.request?.tool_config;
    const functionCallingConfig = rawToolConfig?.functionCallingConfig || rawToolConfig?.function_calling_config;
    const toolConfig = functionCallingConfig ? {
      ...rawToolConfig,
      function_calling_config: undefined,
      functionCallingConfig: {
        ...functionCallingConfig,
        ...(String(functionCallingConfig.mode || "").trim().toUpperCase() === "NONE" && { mode: "NONE" }),
        ...(Array.isArray(functionCallingConfig.allowedFunctionNames) && {
          allowedFunctionNames: functionCallingConfig.allowedFunctionNames.map(sanitizeFunctionName)
        })
      }
    } : null;


    // Strip contents/tools/toolConfig (handled separately) and blacklisted fields that Google rejects
    const { contents: _originalContents, tools: _originalTools, toolConfig: _originalToolConfig, tool_config: _originalSnakeToolConfig, ...requestWithoutTools } = body.request || {};
    stripBlacklisted(requestWithoutTools);

    // Rewrite competitive system prompts only after translation reaches the Antigravity
    // provider boundary. Conversation content and shared Gemini translators stay untouched.
    if (requestWithoutTools.systemInstruction?.parts) {
      const competitiveMarker = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
      for (const part of requestWithoutTools.systemInstruction.parts) {
        if (!isString(part.text)) continue;
        part.text = rewriteOpenCodeBranding(part.text);
        part.text = part.text.replace(ANTIGRAVITY_BILLING_HEADER_RE, "");
        part.text = part.text.replace(ANTIGRAVITY_HERMES_IDENTITY_REWRITE.from, ANTIGRAVITY_HERMES_IDENTITY_REWRITE.to);
        if (part.text.includes(competitiveMarker)) {
          part.text = part.text.split(competitiveMarker).join("");
        }
        for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES.slice(1)) {
          part.text = part.text.replace(from, to);
        }
      }
    }
    // The real client always opens the system prompt with the Antigravity identity (upstream
    // 9router e37cb78e16). Skip it when the prompt already carries one, e.g. AG MITM traffic.
    const needsAgIdentity = !(requestWithoutTools.systemInstruction?.parts || []).some(
      (part) => isString(part?.text) && part.text.includes("You are Antigravity"));
    const generationConfig = { ...(requestWithoutTools.generationConfig || {}) };
    if (isString(generationConfig.thinkingConfig?.thinkingLevel)) {
      generationConfig.thinkingConfig = { ...generationConfig.thinkingConfig, thinkingLevel: generationConfig.thinkingConfig.thinkingLevel.trim().toUpperCase() };
    }
    if (generationConfig.maxOutputTokens > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }
    if (signatureFamily(model) === "claude") {
      const thinking = generationConfig.thinkingConfig || generationConfig.thinking_config;
      const budget = thinking?.thinkingBudget ?? thinking?.thinking_budget;
      if (isNumber(budget) && Number.isFinite(budget)) {
        const max = generationConfig.maxOutputTokens || MAX_ANTIGRAVITY_OUTPUT_TOKENS;
        const bounded = budget >= max ? max - 1 : budget;
        if (bounded >= 0 && bounded < 1024) {
          delete generationConfig.thinkingConfig;
          delete generationConfig.thinking_config;
        } else {
          generationConfig.thinkingConfig = { ...thinking, thinkingBudget: bounded };
          delete generationConfig.thinkingConfig.thinking_budget;
          delete generationConfig.thinking_config;
        }
      }
    }
    // Gemini 4 request rules apply at the provider boundary so every source
    // format (OpenAI, Claude, native Gemini) is covered (upstream eb373017).
    const { generationConfig: finalGenerationConfig, contents: finalContents } =
    applyGemini4RequestRules({ generationConfig, contents }, model);

    // Claude Cloud Code accepts a bounded request shape; retain local route metadata.
    const claudeRequestFields = ["systemInstruction", "generationConfig", "cachedContent", "labels", "sessionMetadata"];
    const supportedRequest = signatureFamily(model) === "claude"
      ? Object.fromEntries(claudeRequestFields.filter((key) => key in requestWithoutTools).map((key) => [key, requestWithoutTools[key]]))
      : requestWithoutTools;
    const transformedRequest = {
      ...supportedRequest,
      generationConfig: finalGenerationConfig,
      ...(finalContents.length > 0 && { contents: finalContents }),
      ...(tools && { tools }),
      safetySettings: undefined,
      ...(!isSearch && (tools?.some((group) => group.functionDeclarations?.length) || toolConfig?.functionCallingConfig?.mode === "NONE") && { toolConfig: toolConfig || { functionCallingConfig: { mode: "VALIDATED" } } })

    };
    if (body.requestType !== "web_search" || ((body.request?.sessionId || credentials?._clientSessionId) && !credentials?._clientSessionIsGenerated)) transformedRequest.sessionId = sessionId;
    else delete transformedRequest.sessionId;

    // Large system prompts exhaust the systemInstruction limit; preserve them in user content.
    const sysInstr = transformedRequest.systemInstruction;
    if (sysInstr) {
      const sysText = sysInstr.parts?.map((part) => part.text || "").join("") || "";
      if (sysText.length > SYSTEM_INSTRUCTION_CHAR_LIMIT) {
        const requestContents = transformedRequest.contents || [];
        const firstUserIndex = requestContents.findIndex((content) => content.role === "user");
        if (firstUserIndex >= 0) {
          const firstUser = requestContents[firstUserIndex];
          const systemHasNonText = sysInstr.parts.some((part) => part.text === undefined);
          const existingText = firstUser.parts?.filter((part) => part.text !== undefined).map((part) => part.text).join("") || "";
          const otherParts = firstUser.parts?.filter((part) => part.text === undefined) || [];
          requestContents[firstUserIndex] = {
            ...firstUser,
            parts: systemHasNonText ?
            [{ text: "[System Instructions]\n" }, ...sysInstr.parts, { text: "\n\n[User Message]\n" }, ...(firstUser.parts || [])] :
            [{ text: `[System Instructions]\n${sysText}\n\n[User Message]\n${existingText}` }, ...otherParts]
          };
        } else {
          const hasNonText = sysInstr.parts.some((part) => part.text === undefined);
          requestContents.unshift({ role: "user", parts: hasNonText ? sysInstr.parts : [{ text: sysText }] });
        }
        transformedRequest.contents = requestContents;
        delete transformedRequest.systemInstruction;
        dbg("TOOLS", `Embedded ${sysText.length} char system prompt into user content (exceeds ${SYSTEM_INSTRUCTION_CHAR_LIMIT} limit)`);
      }
    }

    // Added after the fold above so the identity always stays the leading systemInstruction and
    // only the client's own prompt counts toward SYSTEM_INSTRUCTION_CHAR_LIMIT.
    if (needsAgIdentity) {
      const clientParts = transformedRequest.systemInstruction?.parts || [];
      transformedRequest.systemInstruction = {
        ...(transformedRequest.systemInstruction || { role: GEMINI_ROLE.USER }),
        parts: [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }, ...clientParts]
      };
    }

    // Strip blacklisted thinking fields from top-level body (set by thinkingUnified.js at root, not body.request)
    stripBlacklisted(body);

    this._lastSessionId = transformedRequest.sessionId; // cached for buildHeaders (base.execute order)

    // Official Antigravity client omits `requestType` entirely on the agent
    // (chat) path. Sending `requestType: "agent"` here (or leaking it through
    // from an upstream envelope via the ...body spread below) makes Google
    // bucket the request and return a detail-free 429 RESOURCE_EXHAUSTED even
    // with quota available (oh-my-pi #11689 / PR #11742). `image_gen` and
    // `search` buckets are unaffected and keep their own requestType.
    if (!isSearch) delete body.requestType;

    const cleanedRequest = stripHarnessTelemetry(transformedRequest);
    const transformedBody = stripHarnessTelemetry({
      ...body,
      project: projectId,
      model: model,
      userAgent: "antigravity",
      requestId: buildIdeRequestId({ body, request: transformedRequest, credentials, model, requestType: "agent" }),
      request: cleanedRequest
    });
    // Keep stream available to in-process callers, but omit it from the serialized
    // Cloud Code envelope (the endpoint and URL already carry streaming semantics).
    Object.defineProperty(transformedBody, "stream", {
      value: body.stream,
      configurable: true,
      writable: true,
      enumerable: false
    });
    if (toolNameMap.size) {
      const existing = body._toolNameMap instanceof Map ? body._toolNameMap : new Map();
      const composed = new Map(existing);
      for (const [alias, source] of toolNameMap) composed.set(alias, existing.get(source) || source);
      // Internal response metadata must survive execute() without entering provider JSON.
      delete transformedBody._toolNameMap;
      Object.defineProperty(transformedBody, "_toolNameMap", { value: composed, configurable: true });
    }
    return transformedBody;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const signal = AbortSignal.timeout(30_000);
    try {
      const response = await credentialFetch((url, init) => proxyAwareFetch(url, init, proxyOptions), OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      // Match OmniRoute's permanent OAuth rejection while keeping transient
      // failures eligible for the caller's existing refresh policy.
      const tokens = JSON.parse(await readBoundedResponseText(response, {
        signal, maxBytes: response.ok ? 1024 * 1024 : 8 * 1024,
        timeoutMs: 30_000, throwOnTimeout: true
      }));
      if (!response.ok) {
        return tokens?.error === "invalid_grant" ? { error: "invalid_grant" } : null;
      }

      if (!isString(tokens?.access_token) || !tokens.access_token.trim()) return null;
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token.trim(),
        refreshToken: isString(tokens.refresh_token) && tokens.refresh_token.trim() || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Antigravity refresh request failed (${error.name})`);
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

    // The same body is refused the same way every time; retries only add backoff delay.
    if (isAntigravityPromptRejection(response.status, bodyText)) return false;

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
    // Request-scoped (400): no account lock, no quota refresh; combos move to their next model.
    if (isAntigravityPromptRejection(response.status, bodyText)) {
      return { status: HTTP_STATUS.BAD_REQUEST, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE };
    }
    if (response.status !== 429 && response.status !== 409) return super.parseError(response, bodyText);

    try {
      const errorJson = JSON.parse(bodyText);
      const error = errorJson?.error;
      if (!error || !isObject(error) || Array.isArray(error)) return super.parseError(response, bodyText);
      const details = Array.isArray(error.details) ? error.details : [];

      for (const detail of details) {
        const meta = detail?.metadata || {};
        if (isString(detail?.["@type"]) && detail["@type"].includes("RetryInfo") &&
            isString(detail.retryDelay)) {
          const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
          const delayMs = match ? Number(match[1]) * 1000 : 0;
          if (Number.isFinite(delayMs) && delayMs > 0) {
            return { status: response.status, message: error.message || bodyText, resetsAtMs: Date.now() + delayMs };
          }
        }

        // quotaResetTimeStamp: ISO string — most precise
        if (meta.quotaResetTimeStamp) {
          const ms = new Date(meta.quotaResetTimeStamp).getTime();
          if (ms > Date.now()) {
            return {
              status: response.status,
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
                status: response.status,
                message: errorJson?.error?.message || bodyText,
                resetsAtMs: Date.now() + delayMs
              };
            }
          }
        }
      }
      return { status: response.status, message: error.message || bodyText, noQuotaMetadata: true };
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
