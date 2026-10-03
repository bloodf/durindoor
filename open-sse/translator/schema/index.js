// Translator schema barrel — pure data enums (roles, blocks). No logic here.
export { ROLE, GEMINI_ROLE } from "./roles.js";
export {
  OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM,
  VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES,
  CLAUDE_REDACTED_THINKING_BLOCKS, CLAUDE_NATIVE_BLOCKS,
  CLAUDE_NATIVE_TOOLS, CLAUDE_NATIVE_REQUEST_FIELDS,
} from "./blocks.js";
export { OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH } from "./finishReasons.js";
export { MODEL_FALLBACK, DEFAULT_IMAGE_MIME } from "./defaults.js";
export { COMMANDCODE_EVENT } from "./commandcode.js";
