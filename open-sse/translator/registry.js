import { FORMATS } from "./formats.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { mergeHistoricalToolIdentities } from "./response/openai-responses/historyToolIdentity.js";

export const requestRegistry = new Map();
export const responseRegistry = new Map();

export function register(from, to, requestFn, responseFn) {
  const key = `${from}:${to}`;
  if (requestFn) requestRegistry.set(key, requestFn);
  if (responseFn) responseRegistry.set(key, responseFn);
}

export const getRequestTranslator = (from, to) => requestRegistry.get(`${from}:${to}`);
export const getResponseTranslator = (from, to) => responseRegistry.get(`${from}:${to}`);

// Initialize state for streaming response based on format
export function initState(sourceFormat, requestBody) {
  // Build a name → declared type map from the request tools so response
  // translators can classify custom tools using real metadata instead of
  // guessing from the tool name (e.g. apply_patch).
  const toolTypes = {};
  const toolNamespaces = {};
  const flatToolNamespaces = new Map();
  // Dotted names of namespace subtools declared as custom (upstream #4810).
  const namespacedCustomTools = new Set();
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
            if (subtool.type === "custom") namespacedCustomTools.add(`${name}.${subtool.name}`);
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
    toolNamespaces,
    namespacedCustomTools
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
