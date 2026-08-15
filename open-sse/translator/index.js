import { FORMATS } from "./formats.js";
import { ensureToolCallIds, fixMissingToolResponses, salvageOrphanedToolResults } from "./concerns/toolCall.js";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "./formats/claude.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { filterToOpenAIFormat } from "./formats/openai.js";
import { normalizeThinkingConfig } from "../services/provider.js";
import { applyThinking, applyTransportRequestDefaults, captureThinking, parseSuffix } from "./concerns/thinkingUnified.js";
import { captureSessionId } from "../utils/sessionManager.js";
import { AntigravityExecutor } from "../executors/antigravity.js";
import { PROVIDERS } from "../providers/index.js";

// Registry for translators. Lazy-init guards against circular-import order:
// translator modules call register() (side-effect) before this module's body runs.
// var (not let): hoisted as undefined so register() can run during circular import (no TDZ).
var requestRegistry;
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
    msg.content = msg.content.filter(part => !shouldStrip(part.type));
    if (msg.content.length === 0) msg.content = "";
  }
}

// Translate request: source -> openai -> target. `translationContext` carries
// request-scoped routing intent (never serialized into the provider body).
export function translateRequest(sourceFormat, targetFormat, model, body, stream = true, credentials = null, provider = null, reqLogger = null, stripList = [], connectionId = null, clientTool = null, translationContext = null) {
  ensureInitialized();
  let result = body;
  // chatCore supplies an already-clean mapped model plus explicit context, but
  // public/direct translator callers may still pass `model(level)`. Keep that
  // entry point safe by parsing here as a compatibility fallback.
  const parsedModel = parseSuffix(model);
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
    sourceFormat === FORMATS.CLAUDE
    && targetFormat === FORMATS.GEMINI
    && result.thinking?.type === "enabled"
    && result.thinking.budget_tokens !== undefined
      ? { mode: "budget", budget: result.thinking.budget_tokens }
      : null;

  // Always ensure tool_calls have id (some providers require it)
  ensureToolCallIds(result);
  
  // Fix missing tool responses (insert empty tool_result if needed)
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
  const thinkingIntent = translationContext?.thinkingIntent
    ?? parsedModel.override
    ?? claudeGeminiBudgetIntent
    ?? captureThinking(result);

  // Capture session id from the original body (envelope still intact, e.g. antigravity request.sessionId)
  const clientSessionId = captureSessionId(result, credentials, connectionId, targetFormat);
  const resolvedTranslationContext = Object.freeze({
    ...(translationContext || {}),
    provider,
    thinkingIntent,
    clientSessionId,
  });
  let finalizeTranslatedRequest;
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
      result = directFn(translationModel, result, stream, credentials, resolvedTranslationContext);
      finalizeTranslatedRequest = directFn.finalize;
    } else {
      // Step 1: source -> openai (if source is not openai)
      if (sourceFormat !== FORMATS.OPENAI) {
        const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
        if (toOpenAI) {
          result = toOpenAI(translationModel, result, stream, credentials, resolvedTranslationContext);
          // Log OpenAI intermediate format
          reqLogger?.logOpenAIRequest?.(result);
        }
      }

      // Step 2: openai -> target (if target is not openai)
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
    parsedModel.override
    && result
    && typeof result === "object"
    && Object.prototype.hasOwnProperty.call(result, "model")
  ) {
    result.model = translationModel;
  }

  // Normalize thinking to the target provider-native format (config-driven, capability-aware)
  applyThinking(
    targetFormat,
    resolvedTranslationContext.capabilityModel || translationModel,
    result,
    provider,
    thinkingIntent,
    resolvedTranslationContext.modelCapabilities,
  );
  // Translator-local guards run after centralized thinking normalization.
  finalizeTranslatedRequest?.(translationModel, result);
  // Per-transport registry defaults (e.g. MiniMax openai transport → reasoning_split).
  applyTransportRequestDefaults(targetFormat, result, provider);

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    result = filterToOpenAIFormat(result, {
      preserveCacheControl: !!PROVIDERS[provider]?.quirks?.preserveCacheControl,
    });
  }

  // MiniMax-M3's OpenAI transport does not support forced tool_choice values
  // ("required" or function objects); clamp to "auto" to keep tools enabled.
  if (
    targetFormat === FORMATS.OPENAI
    && (provider === "minimax" || provider === "minimax-cn")
    && translationModel === "MiniMax-M3"
  ) {
    const tc = result?.tool_choice;
    if (tc === "required" || (tc && typeof tc === "object")) {
      result.tool_choice = "auto";
    }
  }

  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    const normalizesNativeClaudeTransport = PROVIDERS[provider]?.quirks?.normalizeNativeClaudeTransport
      || provider === "ollama"
      || provider === "ollama-local";
    if (normalizesNativeClaudeTransport) {
      // Ollama implements the Messages wire contract but not Anthropic's
      // model-specific beta matrix. Normalize system turns without applying
      // Claude-family model downgrades to the upstream Ollama model id.
      result = normalizeClaudePassthrough(result, "", provider);
    }
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    const customMaxOutput = resolvedTranslationContext.modelCapabilities?.maxOutput ?? null;
    result = prepareClaudeRequest(result, provider, apiKey, connectionId, credentials?.rawHeaders, clientSessionId, customMaxOutput);
  }

  // Claude cloaking: rename client tools with _cc suffix (anti-ban)
  // quirk: only providers flagged cloakToolsOnOAuth, and only with an OAuth token
  if (PROVIDERS[provider]?.quirks?.cloakToolsOnOAuth) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    if (apiKey?.includes("sk-ant-oat")) {
      const { body: cloakedBody, toolNameMap } = cloakClaudeTools(result);
      result = cloakedBody;
      if (toolNameMap?.size > 0) {
        result._toolNameMap = toolNameMap;
      }
    }
  }

  // Antigravity cloaking disabled
  // if (provider === FORMATS.ANTIGRAVITY && body.userAgent !== FORMATS.ANTIGRAVITY) {
  //   const { cloakedBody, toolNameMap } = AntigravityExecutor.cloakTools(result);
  //   result = cloakedBody;
  //   if (toolNameMap?.size > 0) {
  //     result._toolNameMap = toolNameMap;
  //   }
  // }

  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(targetFormat, sourceFormat, chunk, state) {
  ensureInitialized();
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return [chunk];
  }

  let results = [chunk];
  let openaiResults = null; // Store OpenAI intermediate results

  // Direct route: if a response translator is registered for this exact
  // target:source pair, use it instead of pivoting through OpenAI. Mirrors the
  // request-side direct route (e.g. kiro:claude — KiroExecutor already emits
  // OpenAI-shaped chunks, so this converts them straight to Claude SSE).
  const directFn = responseRegistry.get(`${targetFormat}:${sourceFormat}`);
  if (directFn) {
    const converted = directFn(chunk, state);
    return converted ? (Array.isArray(converted) ? converted : [converted]) : [];
  }

  // Step 1: target -> openai (if target is not openai)
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

  // Step 2: openai -> source (if source is not openai)
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
  if (Array.isArray(requestBody?.tools)) {
    for (const tool of requestBody.tools) {
      const type = typeof tool?.type === "string" ? tool.type : "";
      const name = typeof tool?.function?.name === "string"
        ? tool.function.name
        : (typeof tool?.name === "string" ? tool.name : "");
      if (name && type) toolTypes[name] = type;
      if (type === "namespace" && name && Array.isArray(tool.tools)) {
        for (const subtool of tool.tools) {
          if (typeof subtool?.name === "string" && subtool.name) {
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
