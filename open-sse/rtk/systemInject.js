// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";
import { OPENAI_BLOCK, RESPONSES_ITEM, ROLE } from "../translator/schema/index.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const SEP = "\n\n";

/**
 * Whether `prompt` is already present in `content`, keyed off its first 100
 * trimmed characters. Returns `false` when `prompt` is empty or non-string.
 * `content` is assumed to be a string by callers.
 *
 * @param {string} content Existing system text to inspect.
 * @param {string} prompt Prompt candidate about to be injected.
 * @returns {boolean} `true` when the prompt signature is already present.
 */
function isPromptAlreadyInjected(content, prompt) {
  if (!content || !prompt) return false;
  const needle = isString(prompt) ? prompt.trim() : '';
  if (!needle) return false;

  // Check if the first 100 chars of the prompt appear in content
  const signature = needle.slice(0, 100);
  return content.includes(signature);
}

/**
 * Inject system prompt using the request shape selected by `format`.
 * Responses/Codex use `body.instructions`; OpenAI chat uses the system/developer message.
 * No-op when `body`/`prompt` empty or the prompt is already present. Mutates `body` in place.
 * @param {object} body translated request body (mutated)
 * @param {string} format one of FORMATS
 * @param {string} prompt system/token-saver text to inject
 */
export function injectSystemPrompt(body, format, prompt) {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, prompt, format);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body, prompt, format) {
  // Responses Lite carries an `additional_tools` envelope at the head of input[];
  // the system prompt must land in a developer message AFTER it, never inside the
  // envelope and never as top-level instructions (Codex rejects both). Detect the
  // envelope BEFORE the Responses/Codex top-level-instructions branch so only the
  // Lite shape routes through input[].
  const isResponsesLite = Array.isArray(body.input) && body.input.some((m) => m?.type === "additional_tools");

  // OpenAI Responses API: Codex rejects instruction messages in input[]; use top-level instructions.
  if (!isResponsesLite && (format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE || format === FORMATS.CODEX || isString(body.instructions))) {
    if (isPromptAlreadyInjected(body.instructions, prompt)) return;
    body.instructions = body.instructions ?
    `${body.instructions}${SEP}${prompt}` :
    prompt;
    return;
  }

  const isChatMessages = Array.isArray(body.messages);
  const arr = isChatMessages ? body.messages :
  Array.isArray(body.input) ? body.input :
  null;
  if (!arr) {
    // Responses also accepts a bare string input with no top-level instructions yet.
    if (isString(body.input)) body.instructions = prompt;
    return;
  }

  const isResponses = arr === body.input;
  const partType = isChatMessages ? OPENAI_BLOCK.TEXT : RESPONSES_ITEM.INPUT_TEXT;
  const idx = arr.findIndex((m) =>
  m && (!m.type || m.type === "message") && (m.role === ROLE.SYSTEM || m.role === ROLE.DEVELOPER)
  );
  if (idx >= 0) {
    // Check if already injected before appending
    const existing = extractTextFromOpenAIMessage(arr[idx]);
    if (isPromptAlreadyInjected(existing, prompt)) return;
    appendToOpenAIMessage(arr[idx], prompt, partType);
  } else if (isResponses) {
    // Responses Lite puts an `additional_tools` envelope first; system prompt
    // must land in a developer message AFTER it, never inside the envelope.
    const insertAt = arr.findIndex((m) => m?.type !== "additional_tools");
    arr.splice(insertAt < 0 ? arr.length : insertAt, 0, {
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.DEVELOPER,
      content: [{ type: partType, text: prompt }]
    });
  } else {
    arr.unshift({ role: ROLE.SYSTEM, content: prompt });
  }
}

function extractTextFromOpenAIMessage(msg) {
  if (isString(msg.content)) {
    return msg.content;
  } else if (Array.isArray(msg.content)) {
    return msg.content.map((part) => part.text || '').join(' ');
  }
  return '';
}

/**
 * @param {string} partType content-part `type` for array-content messages —
 *   `{type:"text"}` for chat `messages[]`, `{type:"input_text"}` for Responses
 *   `input[]`. Strict providers (StepFun) reject the Responses-only
 *   `input_text` on chat with `400 Unrecognized chat message`. Upstream
 *   decolua/9router#3204/#3245, issue #3202.
 */
function appendToOpenAIMessage(msg, prompt, partType) {
  if (isString(msg.content)) {
    msg.content = msg.content ? `${msg.content}${SEP}${prompt}` : prompt;
  } else if (Array.isArray(msg.content)) {
    msg.content.push({ type: partType, text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (isString(body.system) && body.system.length > 0) {
    if (isPromptAlreadyInjected(body.system, prompt)) return;
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    // Check if already injected
    const existingText = body.system.map((block) => block?.text || '').join(' ');
    if (isPromptAlreadyInjected(existingText, prompt)) return;

    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) {lastCacheIdx = i;break;}
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && isObject(body.request) ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    // Check if already injected
    const existingText = sys.parts.map((part) => part.text || '').join(' ');
    if (isPromptAlreadyInjected(existingText, prompt)) return;
    sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}