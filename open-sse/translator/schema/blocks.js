// Content-block "type" discriminators — fixed per format. Pure data (no logic).

// OpenAI chat content blocks + tool_call wrapper.
export const OPENAI_BLOCK = {
  TEXT: "text",
  IMAGE_URL: "image_url",
  IMAGE: "image",
  INPUT_AUDIO: "input_audio",
  AUDIO_URL: "audio_url",
  FILE: "file",
  FUNCTION: "function",
  WEB_SEARCH: "web_search",
  TOOL_CALL: "tool_call",
};

// CommandCode native content blocks.
export const COMMANDCODE_BLOCK = {
  TOOL_CALL: "tool-call",
  TOOL_RESULT: "tool-result",
};

// Claude content blocks.
export const CLAUDE_BLOCK = {
  TEXT: "text",
  IMAGE: "image",
  DOCUMENT: "document",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  TOOL_REFERENCE: "tool_reference",
  TOOL_ADDITION: "tool_addition",
  SERVER_TOOL_USE: "server_tool_use",
  WEB_SEARCH_TOOL_RESULT: "web_search_tool_result",
  WEB_SEARCH_RESULT: "web_search_result",
  WEB_SEARCH_ERROR: "web_search_tool_result_error",
  THINKING: "thinking",
  REDACTED_THINKING: "redacted_thinking",
  SEARCH_RESULT: "search_result",
  CONTAINER_UPLOAD: "container_upload",
};

// OpenAI Responses API item types.
export const RESPONSES_ITEM = {
  MESSAGE: "message",
  WEB_SEARCH_CALL: "web_search_call",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  COMPUTER_CALL: "computer_call",
  COMPUTER_CALL_OUTPUT: "computer_call_output",
  CUSTOM_TOOL_CALL: "custom_tool_call",
  CUSTOM_TOOL_CALL_OUTPUT: "custom_tool_call_output",
  ITEM_REFERENCE: "item_reference",
  REASONING: "reasoning",
  OUTPUT_TEXT: "output_text",
  INPUT_TEXT: "input_text",
  INPUT_IMAGE: "input_image",
  INPUT_FILE: "input_file",
  SUMMARY_TEXT: "summary_text",
};

// OpenAI Responses API `include` entries. These are the only include values a
// caller-provided array may carry onto the Responses wire: the vocabulary is
// the Responses contract itself, so an entry outside it is dropped instead of
// being forwarded to an upstream that would reject it with a 400.
// `message.output_text.logprobs` is a valid Responses include that individual
// targets reject — the per-model filter in translator/concerns/paramSupport.js
// removes it for those models, the translator does not.
export const RESPONSES_INCLUDE = {
  REASONING_ENCRYPTED_CONTENT: "reasoning.encrypted_content",
  MESSAGE_OUTPUT_TEXT_LOGPROBS: "message.output_text.logprobs",
  WEB_SEARCH_CALL_ACTION_SOURCES: "web_search_call.action.sources",
  WEB_SEARCH_CALL_RESULTS: "web_search_call.results",
  OUTPUT_ENCRYPTED_CONTENT: "output.encrypted_content",
  FILE_SEARCH_CALL_RESULTS: "file_search_call.results",
  MESSAGE_INPUT_IMAGE_IMAGE_URL: "message.input_image.image_url",
  COMPUTER_CALL_OUTPUT_OUTPUT_IMAGE_URL: "computer_call_output.output.image_url",
  CODE_INTERPRETER_CALL_OUTPUTS: "code_interpreter_call.outputs",
};

// Flat list of the supported Responses include entries.
export const RESPONSES_INCLUDE_ENTRIES = Object.values(RESPONSES_INCLUDE);

// Valid OpenAI block types (used by filterToOpenAIFormat).
export const VALID_OPENAI_CONTENT_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, OPENAI_BLOCK.INPUT_AUDIO, OPENAI_BLOCK.AUDIO_URL, OPENAI_BLOCK.FILE,
];

// Non-enumerable in-process carriers for native Claude-only request data during
// a Claude → OpenAI → Claude pivot. They never enter an OpenAI wire body.
export const CLAUDE_NATIVE_BLOCKS = Symbol("claudeNativeBlocks");
export const CLAUDE_NATIVE_TOOLS = Symbol("claudeNativeTools");
export const CLAUDE_NATIVE_REQUEST_FIELDS = Symbol("claudeNativeRequestFields");
export const VALID_OPENAI_MESSAGE_TYPES = [
  OPENAI_BLOCK.TEXT, OPENAI_BLOCK.IMAGE_URL, OPENAI_BLOCK.IMAGE, "tool_calls", CLAUDE_BLOCK.TOOL_RESULT,
];
