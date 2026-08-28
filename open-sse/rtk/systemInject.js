// Shared system-prompt injector for Caveman and Ponytail. It mutates only
// recognized translated wire shapes and keeps injection exact-idempotent.

import { OPENAI_BLOCK, RESPONSES_ITEM, ROLE } from "../translator/schema/index.js";
import { FORMATS } from "../translator/formats.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const SEP = "\n\n";

/**
 * Reports whether a complete prompt block already exists in string content.
 * Boundaries use the same separator as injection, so shared prefixes and
 * unrelated substrings do not suppress distinct prompts.
 *
 * @param {string} content Existing system text to inspect.
 * @param {string} prompt Prompt candidate about to be injected.
 * @returns {boolean} `true` when the exact prompt is a complete block.
 */
function isPromptAlreadyInjected(content, prompt) {
  if (!isString(content) || !isString(prompt) || !prompt) return false;
  return content === prompt ||
    content.startsWith(`${prompt}${SEP}`) ||
    content.endsWith(`${SEP}${prompt}`) ||
    content.includes(`${SEP}${prompt}${SEP}`);
}

/**
 * Inject a system prompt using translated wire-shape precedence, then the
 * provider label as a fallback when Claude or Gemini has no system block yet.
 * Mutates `body` in place.
 *
 * @param {object} body translated request body (mutated)
 * @param {string} format translated provider format
 * @param {string} prompt system/token-saver text to inject
 */
export function injectSystemPrompt(body, format, prompt) {
  try {
    if (body === null || !isObject(body) || !isString(prompt) || !prompt) return;

    if (isKiroBody(body) || format === FORMATS.KIRO) {
      injectKiroSystem(body, prompt);
    } else if (isString(body.instructions)) {
      injectInstructionsSystem(body, prompt);
    } else if (Array.isArray(body.messages)) {
      injectOpenAIArray(body.messages, prompt, false);
    } else if (Array.isArray(body.input)) {
      injectOpenAIArray(body.input, prompt, true);
    } else if (isString(body.input)) {
      // String input stays untouched.
      return;
    } else {
      switch (format) {
        case FORMATS.CLAUDE:
          injectClaudeSystem(body, prompt);
          break;
        case FORMATS.GEMINI:
        case FORMATS.GEMINI_CLI:
        case FORMATS.VERTEX:
        case FORMATS.ANTIGRAVITY:
          injectGeminiSystem(body, prompt);
          break;
      }
    }
  } catch {
    // Token-saver injection must never break provider dispatch.
  }
}

function tryMutate(mutation) {
  try {
    mutation();
  } catch {
    // Frozen and hostile provider bodies stay unchanged.
  }
}

function isKiroBody(body) {
  return isString(body.conversationState?.currentMessage?.userInputMessage?.content);
}

function injectInstructionsSystem(body, prompt) {
  if (isPromptAlreadyInjected(body.instructions, prompt)) return;
  const next = body.instructions ? `${body.instructions}${SEP}${prompt}` : prompt;
  tryMutate(() => { body.instructions = next; });
}

function hasPromptBlock(parts, prompt) {
  return parts.some((part) => isString(part?.text) && isPromptAlreadyInjected(part.text, prompt));
}

/**
 * Injects into Chat `messages[]` or Responses `input[]` without interpreting
 * non-message Responses items as messages or changing their order.
 */
function injectOpenAIArray(arr, prompt, isResponses) {
  const partType = isResponses ? RESPONSES_ITEM.INPUT_TEXT : OPENAI_BLOCK.TEXT;
  const isEligible = (item) => item &&
    (!isResponses || item.type === RESPONSES_ITEM.MESSAGE) &&
    (item.role === ROLE.SYSTEM || item.role === ROLE.DEVELOPER);
  const eligible = arr.filter(isEligible);

  if (eligible.some((item) => {
    const content = item.content;
    return isString(content) ?
      isPromptAlreadyInjected(content, prompt) :
      Array.isArray(content) && hasPromptBlock(content, prompt);
  })) return;

  if (eligible.length > 0) {
    appendToOpenAIMessage(eligible[0], prompt, partType);
    return;
  }

  if (!isResponses) {
    tryMutate(() => { arr.unshift({ role: ROLE.SYSTEM, content: prompt }); });
    return;
  }

  const insertAt = arr.findIndex((item) => item?.type !== "additional_tools");
  tryMutate(() => {
    arr.splice(insertAt < 0 ? arr.length : insertAt, 0, {
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.DEVELOPER,
      content: [{ type: partType, text: prompt }]
    });
  });
}

/**
 * Kiro carries its system-like prefix only in current user content. Prepend
 * there exactly once; never invent upstream's unsupported `systemPrompt`.
 */
function injectKiroSystem(body, prompt) {
  const message = body.conversationState?.currentMessage?.userInputMessage;
  if (!message || !isString(message.content) && message.content != null) return;
  if (isPromptAlreadyInjected(message.content, prompt)) return;
  const next = message.content ? `${prompt}${SEP}${message.content}` : prompt;
  tryMutate(() => { message.content = next; });
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
    const next = msg.content ? `${msg.content}${SEP}${prompt}` : prompt;
    tryMutate(() => { msg.content = next; });
  } else if (Array.isArray(msg.content)) {
    tryMutate(() => { msg.content.push({ type: partType, text: prompt }); });
  } else {
    tryMutate(() => { msg.content = prompt; });
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (isString(body.system) && body.system.length > 0) {
    if (isPromptAlreadyInjected(body.system, prompt)) return;
    const next = `${body.system}${SEP}${prompt}`;
    tryMutate(() => { body.system = next; });
    return;
  }
  if (Array.isArray(body.system)) {
    if (hasPromptBlock(body.system, prompt)) return;
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) {lastCacheIdx = i;break;}
    }
    tryMutate(() => {
      if (lastCacheIdx >= 0) body.system.splice(lastCacheIdx, 0, block);
      else body.system.push(block);
    });
    return;
  }
  tryMutate(() => { body.system = prompt; });
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && isObject(body.request) ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    if (hasPromptBlock(sys.parts, prompt)) return;
    tryMutate(() => { sys.parts.push({ text: prompt }); });
    return;
  }
  tryMutate(() => { target[key] = { parts: [{ text: prompt }] }; });
}