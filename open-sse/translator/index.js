import { isOpenRouterAnthropicModel, capOpenAICacheBreakpoints } from "./concerns/openrouterAnthropicCache.js";
import { responsesToClaudeResponse } from "./response/responses-to-claude.js";
import { FORMATS } from "./formats.js";
import { normalizeDsmlChunks } from "./concerns/dsml.js";
import { validateCursorImages } from "./request/openai-to-cursor.js";
import { composeToolNameMaps, ensureToolCallIds, fixMissingToolResponses, normalizeOpenAIToolNames, repairDisplacedToolResults, salvageOrphanedToolResults } from "./concerns/toolCall.js";
import { enforceClaudeToolChoiceThinking, normalizeClaudePassthrough, prepareClaudeRequest, removeNamelessOpenAIToolHistory } from "./formats/claude.js";
import { normalizeDeferredTools } from "./concerns/deferredTools.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { CLAUDE_TOOL_SUFFIX } from "../config/appConstants.js";
import { filterToOpenAIFormat } from "./formats/openai.js";
import { normalizeThinkingConfig } from "../services/provider.js";
import { applyThinking, applyTransportRequestDefaults, captureThinking, parseSuffix } from "./concerns/thinkingUnified.js";
import { captureSessionId } from "../utils/sessionManager.js";
import { ensurePoeUserTurnHasText } from "./concerns/poeImageOnlyUserTurn.js";
import { mergeHistoricalToolIdentities } from "./response/openai-responses/historyToolIdentity.js";
import { PROVIDERS } from "../providers/index.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { ROLE, GEMINI_ROLE } from "./schema/roles.js";
import { ownMessages } from "./concerns/callerMessages.js";

// Registry for translators. Lazy-init guards against circular-import order:
// translator modules call register() (side-effect) before this module's body runs.
// var (not let): hoisted as undefined so register() can run during circular import (no TDZ).
import { isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";var requestRegistry;
var responseRegistry;

// Register translator
export function register(from, to, requestFn, responseFn) {
  requestRegistry ??= new Map();
  responseRegistry ??= new Map();
  const key = `${from}:${to}`;
  if (requestFn) {
    requestRegistry.set(key, requestFn);
  }
  if (responseFn) {
    responseRegistry.set(key, responseFn);
  }
}

// No-op: translators self-register via the static imports at the bottom of this file.
function ensureInitialized() {}

// Strip specific content types from messages (explicit opt-in via strip[] in PROVIDER_MODELS)
function stripContentTypes(body, stripList = []) {
  if (!stripList.length || !body.messages || !Array.isArray(body.messages)) return;
  const imageTypes = new Set(["image_url", "image"]);
  const audioTypes = new Set(["audio_url", "input_audio"]);
  const shouldStrip = (type) => {
    if (imageTypes.has(type)) return stripList.includes("image");
    if (audioTypes.has(type)) return stripList.includes("audio");
    return false;
  };
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter((part) => !shouldStrip(part.type));
    if (msg.content.length === 0) msg.content = "";
  }
}

// Capture the source-format tail before translation drops empty turns. Gemini
// calls assistants "model"; Responses uses input[] rather than messages[].
function detectClientLastRole(body) {
  const items = Array.isArray(body?.messages) ? body.messages :
    Array.isArray(body?.contents) ? body.contents :
    Array.isArray(body?.input) ? body.input : null;
  const role = items?.[items.length - 1]?.role;
  return role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : role;
}

// Translate request: source -> openai -> target. `translationContext` carries
// request-scoped routing intent (never serialized into the provider body).
const isGeminiRequestSource = (format) => format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI;
const isGeminiFamilyTarget = (format) => isGeminiRequestSource(format) || format === FORMATS.ANTIGRAVITY || format === FORMATS.VERTEX;

const XIAOMI_ACCOUNT_MODELS = new Set([
  "mimo-v2.6-pro",
  "mimo-v2.6-flash",
  "mimo-v2.6-pro-ultraspeed"
]);
const XIAOMI_ACCOUNT_COOKIE_KEY = "__mimoAccountCookie";

function bareXiaomiModel(model) {
  const s = String(model || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Return true only when request-local dispatch data proves the Xiaomi request
 * stays on the cloud OpenAI API rather than switching to the Desktop account-service
 * route in `XiaomiMimoExecutor.execute()`.
 */
function isDefiniteXiaomiCloudOpenAIRoute(model, credentials, openAITransport) {
  if (!isRecord(credentials) || !isString(openAITransport?.baseUrl)) return false;
  const isAccountModel = XIAOMI_ACCOUNT_MODELS.has(bareXiaomiModel(model));
  if (isAccountModel && (credentials[XIAOMI_ACCOUNT_COOKIE_KEY] || credentials.providerSpecificData?.mimoPassToken)) {
    return false;
  }
  const rt = credentials.runtimeTransport;
  if (rt?.format && rt.format !== FORMATS.OPENAI) return false;
  if (rt?.baseUrl && rt.baseUrl !== openAITransport.baseUrl) return false;
  const apiKey = isString(credentials.apiKey) ? credentials.apiKey.trim() : "";
  if (apiKey.startsWith("sk-")) return true;
  const hasSessionAuth = Boolean(
    credentials[XIAOMI_ACCOUNT_COOKIE_KEY] ||
    credentials.providerSpecificData?.mimoPassToken ||
    credentials.providerSpecificData?.authMethod === "session" ||
    credentials.authType === "oauth"
  );
  if (hasSessionAuth) return false;
  if (apiKey.length > 0) return true;
  return rt?.format === FORMATS.OPENAI && rt?.baseUrl === openAITransport.baseUrl;
}

/**
 * Resolve explicit OpenAI `cache_control` preservation from provider-wide or
 * transport-scoped registry quirks without opting Xiaomi's account route in.
 */
function shouldPreserveOpenAICacheControl(targetFormat, provider, model, credentials) {
  if (targetFormat !== FORMATS.OPENAI || !provider) return false;
  // OpenRouter relays explicit breakpoints only for anthropic/* models (OmniRoute #19755).
  if (isOpenRouterAnthropicModel(provider, model)) return true;
  const providerConfig = PROVIDERS[provider];
  if (providerConfig?.quirks?.preserveCacheControl === true) return true;
  const openAITransport = Array.isArray(providerConfig?.transports) ?
    providerConfig.transports.find((transport) => transport?.format === FORMATS.OPENAI) :
    null;
  if (openAITransport?.quirks?.preserveCacheControl !== true) return false;
  if (provider === "xiaomi-mimo") {
    return isDefiniteXiaomiCloudOpenAIRoute(model, credentials, openAITransport);
  }
  return credentials?.runtimeTransport?.format === FORMATS.OPENAI &&
    (!openAITransport.baseUrl || credentials.runtimeTransport?.baseUrl === openAITransport.baseUrl);
}

export function translateRequest(sourceFormat, targetFormat, model, body, stream = true, credentials = null, provider = null, reqLogger = null, stripList = [], connectionId = null, clientTool = null, translationContext = null) {
  if (targetFormat === FORMATS.CURSOR) validateCursorImages(body);
  ensureInitialized();
  // Own the message list so the rewrites below never mutate the caller's messages.
  let result = ownMessages(body);
  // Role the client actually ended on, before any translator drops an emptied turn.
  const clientLastRole = detectClientLastRole(body);
  // Provider envelopes (e.g. commandcode's { memory, config, params } wrapper)
  // replace `result` wholesale, dropping any metadata OpenAI-stage translators
  // stash on it. Capture it here and reattach after the envelope translator runs.
  let customToolNames;
  // chatCore supplies an already-clean mapped model plus explicit context, but
  // public/direct translator callers may still pass `model(level)`. Keep that
  // entry point safe by parsing here as a compatibility fallback. The provider
  // scopes the service-tier control, so a tier-shaped suffix on a provider
  // without tier support stays part of the opaque model ID.
  const parsedModel = parseSuffix(model, provider);
  const translationModel = parsedModel.cleanModel;

  // Strip explicit content types (opt-in via strip[] in PROVIDER_MODELS entry)
  stripContentTypes(result, stripList);

  // Normalize thinking config: remove if lastMessage is not user
  normalizeThinkingConfig(result);

  /**
   * OmniRoute #7061: preserve any explicitly-defined Claude thinking budget
   * (including `budget_tokens: 0`, Gemini dynamic thinking) before format
   * translation drops `thinking`; absent budget still falls through to
   * captureThinking below.
   *
   * MUST run AFTER normalizeThinkingConfig: on a non-user-last turn (e.g. a
   * tool-continuation) normalize deletes `thinking`, and a snapshot taken
   * earlier would re-apply a budget the request no longer carries.
   */
  const claudeGeminiBudgetIntent =
  sourceFormat === FORMATS.CLAUDE &&
  targetFormat === FORMATS.GEMINI &&
  result.thinking?.type === "enabled" &&
  result.thinking.budget_tokens !== undefined ?
  { mode: "budget", budget: result.thinking.budget_tokens } :
  null;

  if (sourceFormat === FORMATS.OPENAI && targetFormat === FORMATS.CLAUDE && Array.isArray(result?.messages)) {
    result.messages = removeNamelessOpenAIToolHistory(result.messages);
  }
  // Always ensure tool_calls have id (some providers require it). targetFormat
  // lets a target that validates its own tool-call arguments (e.g. CommandCode)
  // keep rejecting malformed JSON instead of having it silently coerced first.
  ensureToolCallIds(result, targetFormat);

  // Fix missing tool responses (insert empty tool_result if needed). A real result
  // displaced past a non-tool message is hoisted first so no placeholder duplicates it.
  repairDisplacedToolResults(result);
  fixMissingToolResponses(result);

  // Salvage orphaned tool results (tool_result with no matching tool_call).
  // Folds orphan content into user text (`[Tool result: ...]`) instead of
  // deleting — non-lossy for the translated messages[] shape (OpenAI/Claude)
  // and preserves Kiro's reconcileOrphanedToolResults salvage semantics.
  //
  // MUST skip the Gemini family (gemini/gemini-cli/antigravity/vertex): at this
  // point the body still carries native contents[] whose functionResponse ids
  // are keyed per-part, not against the global functionCall set salvage builds,
  // so an unconditional run rewrites legitimate functionResponses into
  // `[Tool result: ...]` text before the gemini->openai conversion can read
  // them. Those formats are salvaged downstream of their own conversion if at
  // all. Responses API function_call_output is structural-stripped separately
  // inside openai-responses.js.
  const skipSalvage =
  sourceFormat === FORMATS.GEMINI ||
  sourceFormat === FORMATS.GEMINI_CLI ||
  sourceFormat === FORMATS.ANTIGRAVITY ||
  sourceFormat === FORMATS.VERTEX;
  if (!skipSalvage) {
    salvageOrphanedToolResults(result);
  }

  // Capture thinking intent from the original (pre-translation) body, before any
  // format conversion strips/renames the fields. Applied after translation.
  // Capture the latest Claude system directive before the OpenAI pivot drops it.
  const directiveEffort = sourceFormat === FORMATS.CLAUDE && targetFormat !== FORMATS.CLAUDE &&
    (targetFormat === FORMATS.OPENAI || !requestRegistry.get(`${sourceFormat}:${targetFormat}`))
    ? result.messages?.findLast((message) => message?.role === ROLE.SYSTEM &&
        isString(message.output_config?.effort) && message.output_config.effort.trim())?.output_config.effort.trim().toLowerCase()
    : null;
  const thinkingIntent = translationContext?.thinkingIntent ??
  parsedModel.override ??
  claudeGeminiBudgetIntent ??
  captureThinking(
    directiveEffort ? { ...result, output_config: { ...result.output_config, effort: directiveEffort } } : result,
    translationContext?.capabilityModel || translationModel,
    provider,
    translationContext?.modelCapabilities
  );

  // Capture session id from the original body (envelope still intact, e.g. antigravity request.sessionId)
  const clientSessionId = captureSessionId(result, credentials, connectionId, targetFormat);
  const preserveCacheControl = shouldPreserveOpenAICacheControl(
    targetFormat,
    provider,
    translationContext?.capabilityModel || translationModel,
    credentials
  );
  const resolvedTranslationContext = Object.freeze({
    ...(translationContext || {}),
    provider,
    preserveCacheControl,
    thinkingIntent,
    clientSessionId
  });
  let finalizeTranslatedRequest;
  let responsesToolAliases = null;
  // Expose to downstream translators (gemini-cli/antigravity envelopes) that run after envelope is stripped
  if (credentials) {
    credentials._clientSessionId = clientSessionId;
    if (connectionId) credentials._signatureNamespace = connectionId;
  }

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Direct route: if a translator is registered for this exact source:target
    // pair, use it instead of pivoting through OpenAI. This is lossless for
    // pairs like claude:kiro (avoids the claude->openai->kiro double-hop).
    const directFn = requestRegistry.get(`${sourceFormat}:${targetFormat}`);
    if (directFn) {
      /**
       * Chat→Claude is registered as a direct `openai:claude` route, so it never
       * enters the Responses pivot clamp below. Alias dotted / overlong names on
       * the OpenAI-shaped body before conversion so declarations, tool_choice,
       * and history share one round-trip map (#1343).
       * Do not widen this to Responses→Chat — that direct route is owned by #1384.
       */
      if (sourceFormat === FORMATS.OPENAI && targetFormat === FORMATS.CLAUDE && isObject(result)) {
        const credential = credentials?.accessToken || credentials?.apiKey;
        const willSuffixTools = PROVIDERS[provider]?.quirks?.cloakToolsOnOAuth &&
          isString(credential) && credential.includes("sk-ant-oat");
        responsesToolAliases = normalizeOpenAIToolNames(result, willSuffixTools ? 64 - CLAUDE_TOOL_SUFFIX.length : 64);
      }
      result = directFn(translationModel, result, stream, credentials, resolvedTranslationContext);
      finalizeTranslatedRequest = directFn.finalize;
      /**
       * Direct Responses→Chat (`openai-responses:openai`) never enters the OpenAI
       * pivot below where overlong/dotted names are aliased. Apply the same clamp
       * so Chat upstreams and the response round-trip map stay consistent (#1345).
       */
      // Gemini histories may leave a functionCall unanswered; Chat/Claude upstreams reject that.
      if (isGeminiRequestSource(sourceFormat) && targetFormat === FORMATS.OPENAI && isObject(result)) fixMissingToolResponses(result);
      if ((sourceFormat === FORMATS.OPENAI_RESPONSES || isGeminiRequestSource(sourceFormat)) && targetFormat === FORMATS.OPENAI && isObject(result)) {
        responsesToolAliases = normalizeOpenAIToolNames(result);
      }
    } else {
      if (sourceFormat !== FORMATS.OPENAI) {
        const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
        if (toOpenAI) {
          result = toOpenAI(translationModel, result, stream, credentials, resolvedTranslationContext);
          customToolNames = result._customToolNames;
          if (isGeminiRequestSource(sourceFormat) && isObject(result)) fixMissingToolResponses(result);
          /**
           * Responses namespace tools expand to dotted `{namespace}.{subtool}` names that
           * Claude, Kiro and OpenAI-format upstreams reject. Alias the OpenAI intermediate
           * once, before any target translator, so declarations, tool_choice and history
           * share one map whatever the target (upstream PR #4200).
           * chatCore aliases again for OpenAI targets with the provider's
           * `toolNameMaxLength`; that is deliberate, and both maps compose into
           * one toolNameMap that the response path restores (#1406).
           */
          if ((sourceFormat === FORMATS.OPENAI_RESPONSES || isGeminiRequestSource(sourceFormat)) && isObject(result)) {
            responsesToolAliases = normalizeOpenAIToolNames(result);
          }
          // Responses developer items survive the pivot with role "developer", which the
          // Gemini converters skip. Promote them to system so they land in systemInstruction.
          if (sourceFormat === FORMATS.OPENAI_RESPONSES && isGeminiFamilyTarget(targetFormat) && Array.isArray(result?.messages)) {
            result.messages = result.messages.map((message) => message?.role === ROLE.DEVELOPER ? { ...message, role: ROLE.SYSTEM } : message);
          }
          // Log OpenAI intermediate format
          reqLogger?.logOpenAIRequest?.(result);
        }
      }

      if (targetFormat !== FORMATS.OPENAI) {
        const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
        if (fromOpenAI) {
          result = fromOpenAI(translationModel, result, stream, credentials, resolvedTranslationContext);
        }
      }
    }
  }

  // Direct callers may provide a request body that still contains the
  // recognized suffix. Keep same-format translations safe as well; unknown
  // parenthesized IDs have no override and remain untouched.
  if (
  parsedModel.override &&
  result && isObject(
    result) &&
  Object.prototype.hasOwnProperty.call(result, "model"))
  {
    result.model = translationModel;
  }

  // Normalize thinking to the target provider-native format (config-driven, capability-aware)
  applyThinking(
    targetFormat,
    resolvedTranslationContext.capabilityModel || translationModel,
    result,
    provider,
    thinkingIntent,
    resolvedTranslationContext.modelCapabilities
  );
  // Translator-local guards run after centralized thinking normalization.
  finalizeTranslatedRequest?.(translationModel, result);
  // Per-transport registry defaults (e.g. MiniMax openai transport → reasoning_split).
  applyTransportRequestDefaults(targetFormat, result, provider);

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    // Responses/Gemini sources only expose messages[] after translation.
    if (isObject(result)) repairDisplacedToolResults(result);
    result = filterToOpenAIFormat(result, {
      preserveCacheControl,
      preserveDeveloperRole: provider === "openai" && sourceFormat === FORMATS.OPENAI,
      preserveVideo: resolvedTranslationContext.modelCapabilities?.videoInput === true ||
        getCapabilitiesForModel(provider, translationModel).videoInput === true
    });
    // Anthropic allows four breakpoints; OpenRouter anthropic/* only (other providers unchanged).
    if (preserveCacheControl && isOpenRouterAnthropicModel(provider, translationContext?.capabilityModel || translationModel)) {
      result = capOpenAICacheBreakpoints(result);
    }
    // Poe rejects image-only user turns with 400; Poe-only, other providers unchanged.
    if (Array.isArray(result?.messages)) result.messages = ensurePoeUserTurnHasText(result.messages, provider);
    /**
     * Chat→OpenAI same-format skips the pivot/direct clamps. Alias here so Chat
     * upstreams reject neither dots nor overlong names (#1343). Scoped to Chat
     * sources only — Responses→Chat is owned by the pivot / #1384 direct block.
     */
    if (sourceFormat === FORMATS.OPENAI && isObject(result)) {
      responsesToolAliases = normalizeOpenAIToolNames(result);
    }
  }

  // MiniMax-M3's OpenAI transport does not support forced tool_choice values
  // ("required" or function objects); clamp to "auto" to keep tools enabled.
  if (
  targetFormat === FORMATS.OPENAI && (
  provider === "minimax" || provider === "minimax-cn") &&
  translationModel === "MiniMax-M3")
  {
    const tc = result?.tool_choice;
    if (tc === "required" || tc && isObject(tc)) {
      result.tool_choice = "auto";
    }
  }


  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    const normalizesNativeClaudeTransport = PROVIDERS[provider]?.quirks?.normalizeNativeClaudeTransport ||
    provider === "ollama" ||
    provider === "ollama-local";
    if (normalizesNativeClaudeTransport) {
      /**
       * Ollama implements the Messages wire contract but not Anthropic's model beta matrix.
       * Normalize against its model id while preserving the caller's assistant-prefill policy.
       */
      result = normalizeClaudePassthrough(result, "", provider, null, { rawHeaders: credentials?.rawHeaders, clientLastRole });
    }
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    const customMaxOutput = resolvedTranslationContext.modelCapabilities?.maxOutput ?? null;
    /**
     * Kimi's Claude-compatible endpoint takes deferred MCP definitions in
     * tools[] and rejects the beta-only `tool_addition` blocks Claude Code
     * sends mid-session. Hoist them before the Claude wire is prepared.
     */
    if (provider === "kimi") result = normalizeDeferredTools(result);
    result = prepareClaudeRequest(result, provider, apiKey, connectionId, credentials?.rawHeaders, clientSessionId, customMaxOutput, clientLastRole);
    /**
     * Forced tool choice is rejected by every thinking model, so this must run
     * on the TRANSLATED path too — not just native Claude passthrough. An
     * OpenAI client sending tool_choice:"required" (OMP, Codex, most agentic
     * harnesses) is converted to Anthropic's {type:"any"} by
     * convertOpenAIToolChoice, which is exactly the shape Anthropic refuses
     * once thinking is on. applyThinking has already run, so body.thinking is
     * final here.
     */
    enforceClaudeToolChoiceThinking(result, resolvedTranslationContext.capabilityModel || model, provider);
  }

  // Claude cloaking: rename client tools with _cc suffix (anti-ban)
  // quirk: only providers flagged cloakToolsOnOAuth, and only with an OAuth token
  if (PROVIDERS[provider]?.quirks?.cloakToolsOnOAuth) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    if (apiKey?.includes("sk-ant-oat")) {
      const { body: cloakedBody, toolNameMap } = cloakClaudeTools(result);
      const cloakApplied = cloakedBody !== result;
      result = cloakedBody;
      if (toolNameMap?.size > 0) {
        result._toolNameMap = toolNameMap;
      }
      // Explicit signal, independent of the map: cloaking was applied to this
      // request, so the response path may strip the suffix if the map is lost.
      if (cloakApplied) result._claudeCloaked = true;
    }
  }

  if (responsesToolAliases?.size && isObject(result)) {
    result._toolNameMap = composeToolNameMaps(responsesToolAliases, result._toolNameMap);
  }


  // Provider envelopes may replace the body outright (commandcode, kiro, ...).
  // Keep response-conversion metadata outside those envelopes so chatCore can
  // consume and remove it before sending the request onward.
  if (customToolNames && isObject(result) && !Object.prototype.hasOwnProperty.call(result, "_customToolNames")) {
    result._customToolNames = customToolNames;
  }
  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(targetFormat, sourceFormat, chunk, state) {
  ensureInitialized();
  if (targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.CLAUDE && state.searchEnabled) {
    const converted = responsesToClaudeResponse(chunk, state);
    return converted ? Array.isArray(converted) ? converted : [converted] : [];
  }
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return targetFormat === FORMATS.OPENAI ? normalizeDsmlChunks([chunk], state) : [chunk];
  }

  let results = [chunk];
  let openaiResults = null; // Store OpenAI intermediate results

  // Direct route: if a response translator is registered for this exact
  // target:source pair, use it instead of pivoting through OpenAI. Mirrors the
  // request-side direct route (e.g. kiro:claude — KiroExecutor already emits
  // OpenAI-shaped chunks, so this converts them straight to Claude SSE).
  const directFn = responseRegistry.get(`${targetFormat}:${sourceFormat}`);
  if (directFn && targetFormat !== FORMATS.OPENAI) {
    const converted = directFn(chunk, state);
    return converted ? Array.isArray(converted) ? converted : [converted] : [];
  }

  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      results = [];
      const converted = toOpenAI(chunk, state);
      if (converted) {
        results = Array.isArray(converted) ? converted : [converted];
        openaiResults = results; // Store OpenAI intermediate
      }
    }
  }

  // Flush sentinel: a null chunk means "the stream ended" (stream.js flush).
  // When step 1 has nothing to convert, forward the sentinel so the source-side
  // translator can finalize a dangling message (all openai→X translators
  // null-check their chunk, so this is a no-op unless one implements a flush).
  if (chunk === null && results.length === 0) {
    results = [null];
  }

  results = normalizeDsmlChunks(results, state);

  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = responseRegistry.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults = [];
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) {
          finalResults.push(...(Array.isArray(converted) ? converted : [converted]));
        }
      }
      results = finalResults;
    }
  }

  // Attach OpenAI intermediate results for logging
  if (openaiResults && sourceFormat !== FORMATS.OPENAI && targetFormat !== FORMATS.OPENAI) {
    results._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat, targetFormat) {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat, requestBody) {
  // Build a name → declared type map from the request tools so response
  // translators can classify custom tools using real metadata instead of
  // guessing from the tool name (e.g. apply_patch).
  const toolTypes = {};
  const toolNamespaces = {};
  const flatToolNamespaces = new Map();
  const plainToolNames = new Set();
  // Chat Completions custom tools ({type:"custom", custom:{name}}) the client declared (#1436).
  const chatCustomToolNames = new Set();
  const declaredTools = [
    ...(Array.isArray(requestBody?.tools) ? requestBody.tools : []),
    ...(Array.isArray(requestBody?.input) ? requestBody.input.flatMap((item) => item?.type === "additional_tools" && Array.isArray(item.tools) ? item.tools : []) : [])
  ];
  if (declaredTools.length) {
    for (const tool of declaredTools) {
      const type = isString(tool?.type) ? tool.type : "";
      const name = isString(tool?.function?.name) ?
      tool.function.name :
      isString(tool?.custom?.name) ? tool.custom.name :
      isString(tool?.name) ? tool.name : "";
      if (name && type) toolTypes[name] = type;
      if (type === "custom" && name && sourceFormat === FORMATS.OPENAI) chatCustomToolNames.add(name);
      if (type === "namespace" && name && Array.isArray(tool.tools)) {
        for (const subtool of tool.tools) {
          if (isString(subtool?.name) && subtool.name) {
            // Only the dotted form is mapped. A bare subtool name (e.g. "click")
            // can collide with an unrelated plain function tool of the same name;
            // namespace restoration must rely on the provider-translated dotted
            // tool name to disambiguate.
            toolNamespaces[`${name}.${subtool.name}`] = name;
            const namespaces = flatToolNamespaces.get(subtool.name) || new Set();
            namespaces.add(name);
            flatToolNamespaces.set(subtool.name, namespaces);
          }
        }
      } else if (name) {
        plainToolNames.add(name);
      }
    }
    for (const [name, namespaces] of flatToolNamespaces) {
      if (namespaces.size === 1 && !plainToolNames.has(name)) {
        toolNamespaces[name] = namespaces.values().next().value;
      }
    }
  }

  // A follow-up turn that continues a conversation (previous_response_id) or
  // simply omits `tools` still carries the namespace identity of every earlier
  // call in its own `input` history. Recover it so the response translator
  // restores `{namespace, name}` instead of forwarding a flat dotted name
  // (OmniRoute #15974). Current declarations always win.
  mergeHistoricalToolIdentities(toolNamespaces, requestBody?.input);

  // Base state for all formats
  const base = {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1,
    toolTypes,
    chatCustomToolNames,
    toolNamespaces
  };

  // Add openai-responses specific fields
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return {
      ...base,
      seq: 0,
      responseId: `resp_${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: "",
      nextOutputIndex: 0,
      msgOutputIndexes: {},
      funcOutputIndexes: {},
      reasoningIndex: -1,
      reasoningBuf: "",
      reasoningPartAdded: false,
      reasoningDone: false,
      inThinking: false,
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcArgsDone: {},
      funcItemDone: {},
      funcItemAdded: {},
      funcPendingArgs: {},
      funcCustomInput: {},
      funcCustomDeltaEmitted: {},
      awaitingTrailingUsage: false,
      // Isolated from provider-native state.usage used by the first pivot hop.
      responsesUsage: null,
      completedSent: false
    };
  }

  return base;
}

// Kept for backward compatibility; translators are already registered at import time.
export function initTranslators() {
  ensureInitialized();
}

// Static side-effect imports: each module calls register() at load (works in ESM + bundler).
import "./request/claude-to-openai.js";
import "./request/openai-to-claude.js";
import "./request/gemini-to-openai.js";
import "./request/openai-to-gemini.js";
import "./request/openai-to-vertex.js";
import "./request/antigravity-to-openai.js";
import "./request/openai-responses.js";
import "./request/openai-to-kiro.js";
import "./request/openai-to-cursor.js";
import "./request/openai-to-ollama.js";
import "./request/openai-to-commandcode.js";
import "./request/claude-to-kiro.js";
import "./request/claude-to-gemini.js";
import "./response/claude-to-openai.js";
import "./response/openai-to-claude.js";
import "./response/gemini-to-openai.js";
import "./response/openai-to-antigravity.js";
import "./response/openai-to-gemini.js";
import "./response/openai-responses.js";
import "./response/kiro-to-openai.js";
import "./response/cursor-to-openai.js";
import "./response/ollama-to-openai.js";
import "./response/commandcode-to-openai.js";
import "./response/kiro-to-claude.js";
import "./response/gemini-to-claude.js";
