import { isBoolean, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const MAX_SANE_TOKEN_LIMIT = 16_777_216;
const CONTEXT_KEYS = ["max_model_len", "max_context_window_tokens", "context_length", "context_window", "max_context_length", "contextLength", "contextWindow", "context"];
const INPUT_KEYS = ["max_input_tokens", "max_prompt_tokens", "inputTokenLimit", "maxInputTokens", "maxInput"];
const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "outputTokenLimit", "max_tokens", "maxOutputTokens", "maxOutput", "output"];
const DEFAULT_OUTPUT_KEYS = ["defaultOutput", "default_output_tokens", "defaultOutputTokens"];
const BOOLEAN_KEYS = ["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "videoOutput", "tools", "reasoning", "search", "structuredOutput", "promptCaching", "thinkingCanDisable"];
const FLAG_ALIASES = { supportsTools: "tools", supports_tools: "tools", tool_call: "tools", structured_output: "structuredOutput", prompt_caching: "promptCaching", supportsReasoning: "reasoning", isReasoning: "reasoning", isVL: "vision" };
const INPUT_FLAGS = { image: "vision", pdf: "pdf", audio: "audioInput", video: "videoInput" };
const OUTPUT_FLAGS = { image: "imageOutput", audio: "audioOutput", video: "videoOutput" };
const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);

function positiveLimit(value) {
  if (!isNumber(value) && !(isString(value) && value.trim())) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_SANE_TOKEN_LIMIT ? number : undefined;
}

function readLimit(source, keys) {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    const value = positiveLimit(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function boundedThinkingRange(value) {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { min, max } = value;
  if (min !== undefined && min !== null &&
    (!Number.isSafeInteger(min) || min < 0 || min > MAX_SANE_TOKEN_LIMIT)) return undefined;
  if (max !== undefined && max !== null &&
    (!Number.isSafeInteger(max) || max <= 0 || max > MAX_SANE_TOKEN_LIMIT)) return undefined;
  if (min !== undefined && min !== null && max !== undefined && max !== null && min > max) return undefined;
  return {
    ...(min !== undefined ? { min } : null),
    ...(max !== undefined ? { max } : null),
  };
}

/**
 * Limits > meta > native capability limits > capabilities > limit > root.
 * Generic input budgets alone are not total windows. Only the explicit wire
 * budget pair max_input_tokens + max_output_tokens within one source is summed.
 * Canonical maxInput/maxOutput are independent ceilings, not additive budgets:
 * decoding a native row into canonical fields must not later invent a window.
 * Malformed pairs never discard an independently valid output cap.
 * Native Anthropic ModelInfo rows (type:"model" plus their required native limit
 * fields), or explicit format:"anthropic", treat max_input_tokens as the native
 * window. That root declaration precedes enriched metadata; max_tokens is never
 * added. Native Gemini Model rows (models/ name plus generation methods), or
 * explicit format:"gemini", treat inputTokenLimit as the native window.
 * Untyped/stripped rows need the provider adapter to supply the format.
 * Explicit format:"generic" disables native shape recognition.
 * Generation defaults and compaction thresholds are deliberately not read.
 */
export function extractLiveModelLimits(model, { format = "auto" } = {}) {
  if (!isRecord(model)) return {};
  const nativeAnthropic = format === "anthropic" || (format === "auto" &&
    model.type === "model" && Object.hasOwn(model, "max_input_tokens") && Object.hasOwn(model, "max_tokens"));
  const nativeGemini = format === "gemini" || (format === "auto" &&
    isString(model.name) && model.name.startsWith("models/") &&
    Array.isArray(model.supportedGenerationMethods) && Object.hasOwn(model, "inputTokenLimit"));
  const native = nativeAnthropic || nativeGemini;
  const sources = [model.limits, model.meta, model.capabilities?.limits, model.capabilities, model.limit, model];
  let contextWindow = native ? readLimit(model, CONTEXT_KEYS) ??
    positiveLimit(nativeAnthropic ? model.max_input_tokens : model.inputTokenLimit) : undefined;
  let maxInput;
  let defaultOutput;
  let maxOutput;
  for (const source of sources) {
    const input = readLimit(source, INPUT_KEYS);
    const output = readLimit(source, OUTPUT_KEYS);
    contextWindow ??= readLimit(source, CONTEXT_KEYS);
    if (contextWindow === undefined && !native && isRecord(source)) {
      const inputBudget = positiveLimit(source.max_input_tokens);
      const outputBudget = positiveLimit(source.max_output_tokens);
      if (inputBudget !== undefined && outputBudget !== undefined) {
        contextWindow = positiveLimit(inputBudget + outputBudget);
      }
    }
    maxInput ??= input;
    maxOutput ??= output;
    defaultOutput ??= readLimit(source, DEFAULT_OUTPUT_KEYS);
  }
  return {
    ...(contextWindow !== undefined ? { contextWindow } : null),
    ...(maxInput !== undefined ? { maxInput } : null),
    ...(maxOutput !== undefined ? { maxOutput } : null),
    ...(defaultOutput !== undefined ? { defaultOutput } : null),
  };
}

function modalities(raw, direction) {
  const candidates = [raw[direction], raw[`${direction}_modalities`], raw.modalities?.[direction], raw.architecture?.[`${direction}_modalities`]];
  const arrays = candidates.filter(Array.isArray);
  if (!arrays.length) return null;
  const values = new Set(arrays.flat().filter(isString).map((value) => value.trim().toLowerCase())
    .filter((value) => ["text", "image", "pdf", "audio", "video", "embedding"].includes(value)));
  return values.size ? values : null;
}

/** Native shapes are recognized; adapters stripping them must pass the known API format. */
export function extractApiCapabilities(raw, options) {
  if (!isRecord(raw)) return {};
  const caps = extractLiveModelLimits(raw, options);
  const input = modalities(raw, "input");
  if (input) {
    caps.vision = input.has("image");
    // PDF/video API formats may be implemented over the native image modality.
    // Their absence in a text/image catalog is not an explicit unsupported flag.
    for (const [modality, flag] of Object.entries(INPUT_FLAGS)) {
      if (input.has(modality)) caps[flag] = true;
    }
  }
  const output = modalities(raw, "output");
  if (output) for (const [modality, flag] of Object.entries(OUTPUT_FLAGS)) caps[flag] = output.has(modality);

  const apiCaps = isRecord(raw.capabilities) ? raw.capabilities : {};
  for (const source of [raw, apiCaps]) {
    const supports = isRecord(source.supports) ? source.supports : {};
    if (isBoolean(supports.vision)) caps.vision = supports.vision;
    if (isBoolean(supports.tool_calls)) caps.tools = supports.tool_calls;
    for (const key of ["supportsReasoning", "isReasoning", "thinking", "reasoning"]) {
      if (isBoolean(supports[key])) caps.reasoning = supports[key];
    }
    for (const [key, target] of Object.entries({ image_input: "vision", pdf_input: "pdf", thinking: "reasoning", structured_outputs: "structuredOutput", prompt_caching: "promptCaching" })) {
      if (isBoolean(source[key]?.supported)) caps[target] = source[key].supported;
    }
  }

  // Canonical booleans are explicit declarations, not hints: false must win
  // over modality arrays, native support objects and inferred effort support.
  for (const source of [raw, raw.capabilities]) {
    if (!isRecord(source)) continue;
    if (isBoolean(source.thinking)) caps.reasoning = source.thinking;
    for (const [key, target] of Object.entries(FLAG_ALIASES)) if (isBoolean(source[key])) caps[target] = source[key];
    for (const key of BOOLEAN_KEYS) if (isBoolean(source[key])) caps[key] = source[key];
    for (const key of ["thinkingEfforts", "thinkingModes", "supportedTools"]) {
      if (Array.isArray(source[key]) && source[key].length && source[key].every(isString)) caps[key] = [...source[key]];
    }
    for (const key of ["thinkingFormat", "thinkingType"]) if (isString(source[key])) caps[key] = source[key];
    const thinkingRange = boundedThinkingRange(source.thinkingRange);
    if (thinkingRange !== undefined) caps.thinkingRange = thinkingRange;
  }
  // Effort lists are hints only. Resolve all explicit declarations first so
  // unsupported (false) remains distinct from missing/unknown (undefined).
  if (Array.isArray(raw.supported_reasoning_levels)) {
    const efforts = raw.supported_reasoning_levels.map((level) => isString(level) ? level : level?.effort).filter((level) => isString(level) && level.length > 0);
    if (efforts.length) {
      caps.reasoning ??= true;
      caps.thinkingEfforts ??= efforts;
      caps.thinkingCanDisable ??= efforts.includes("none");
    }
  }
  for (const key of Object.keys(caps)) if (caps[key] === undefined) delete caps[key];
  return caps;
}

/**
 * Data-only OpenAI extensions. OMP generic discovery consumes modality arrays,
 * max_model_len/context_length and limits.max_output_tokens; its current
 * decoder does not consume every capability extension advertised here.
 * When total context is unknown, keep maxInput in canonical capabilities only:
 * emitting a nested input/output pair would make OMP invent their summed window.
 * Preserve bounded thinking budgets and provider attribution as data, never
 * provider headers, endpoints, credentials or executable config.
 */
export function projectDiscoveryMetadata(model) {
  const caps = extractApiCapabilities(model);
  const kind = model.kind || "llm";
  const contextWindow = readLimit(model, CONTEXT_KEYS) ?? positiveLimit(caps.contextWindow);
  const maxOutput = readLimit(model, OUTPUT_KEYS) ?? positiveLimit(caps.maxOutput);
  const maxInput = readLimit(model, INPUT_KEYS) ?? positiveLimit(caps.maxInput);
  if (contextWindow !== undefined) caps.contextWindow = contextWindow;
  if (maxInput !== undefined) caps.maxInput = maxInput;
  if (maxOutput !== undefined) caps.maxOutput = maxOutput;
  const input = [...(modalities(model, "input") ?? (kind === "stt" ? ["audio"] : ["text"]))];
  const defaultOutput = { embedding: ["embedding"], image: ["image"], tts: ["audio"], video: ["video"], music: ["audio"] };
  const output = [...(modalities(model, "output") ?? defaultOutput[kind] ?? ["text"])];
  for (const [values, flags] of [[input, INPUT_FLAGS], [output, OUTPUT_FLAGS]]) {
    for (const [modality, flag] of Object.entries(flags)) {
      if (caps[flag] === true && !values.includes(modality)) values.push(modality);
      if (caps[flag] === false && values.includes(modality)) values.splice(values.indexOf(modality), 1);
    }
  }
  const limits = {
    ...(maxInput !== undefined && contextWindow !== undefined ? { max_input_tokens: maxInput } : null),
    ...(maxOutput !== undefined ? { max_output_tokens: maxOutput } : null),
  };
  const identity = {};
  for (const key of ["id", "object", "created", "created_at", "owned_by", "name", "display_name", "description", "kind", "provider_name", "provider_alias", "gateway_provider"]) {
    if (isString(model[key]) || (key === "created" && Number.isSafeInteger(model[key]))) identity[key] = model[key];
  }
  return {
    ...identity,
    capabilities: caps,
    input,
    input_modalities: input,
    output,
    output_modalities: output,
    ...(isBoolean(caps.reasoning) ? { reasoning: caps.reasoning } : null),
    ...(isBoolean(caps.tools) ? { supportsTools: caps.tools, supports_tools: caps.tools } : null),
    ...(isBoolean(caps.structuredOutput) ? { structured_output: caps.structuredOutput } : null),
    ...(isBoolean(caps.promptCaching) ? { prompt_caching: caps.promptCaching } : null),
    ...(contextWindow !== undefined ? { context_length: contextWindow, max_model_len: contextWindow } : null),
    ...(maxOutput !== undefined ? { max_output_tokens: maxOutput, max_completion_tokens: maxOutput } : null),
    ...(Object.keys(limits).length ? { limits } : null),
  };
}
