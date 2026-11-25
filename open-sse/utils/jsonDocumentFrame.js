/**
 * A forced-streaming provider answering a non-stream request can send one whole
 * JSON document (chat.completion, Responses object or Anthropic message)
 * labelled text/event-stream, sometimes followed by a glued "data: [DONE]". No
 * line of it starts with "data:", so a line-based SSE scan sees nothing
 * (decolua/9router#5130). This projects such a document onto one chat-delta
 * frame so the stream peek judges it by the same rules as any other frame.
 */
import { CLAUDE_BLOCK, CLAUDE_STOP, OPENAI_FINISH, RESPONSES_ITEM } from "../translator/schema/index.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { hasResponsesContentItem } from "./responsesContent.js";

const joinText = (parts, key) => parts.map((part) => (isString(part?.[key]) ? part[key] : "")).join("");

function chatFrame(doc) {
  const choices = doc.choices.map((choice) => ({ ...choice, delta: choice?.message ?? choice?.delta ?? {} }));
  return { ...doc, choices };
}

function responsesFrame(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  const messages = output.filter((item) => item?.type === RESPONSES_ITEM.MESSAGE);
  const reasoning = output.filter((item) => item?.type === RESPONSES_ITEM.REASONING);
  const others = output.filter((item) => !messages.includes(item) && !reasoning.includes(item));
  const filtered = response.incomplete_details?.reason === OPENAI_FINISH.CONTENT_FILTER;
  return {
    error: response.error ?? undefined,
    choices: [{
      finish_reason: filtered ? OPENAI_FINISH.CONTENT_FILTER : null,
      delta: {
        content: joinText(messages.flatMap((item) => item.content || []), "text"),
        refusal: joinText(messages.flatMap((item) => item.content || []), "refusal") || undefined,
        reasoning_content: joinText(reasoning.flatMap((item) => item.summary || []), "text"),
        tool_calls: others.filter(hasResponsesContentItem),
      },
    }],
  };
}

function claudeFrame(message) {
  const blocksOf = (type) => message.content.filter((block) => block?.type === type);
  return {
    choices: [{
      finish_reason: message.stop_reason === CLAUDE_STOP.REFUSAL ? OPENAI_FINISH.CONTENT_FILTER : null,
      delta: {
        content: joinText(blocksOf(CLAUDE_BLOCK.TEXT), "text"),
        reasoning_content: joinText(blocksOf(CLAUDE_BLOCK.THINKING), "thinking"),
        tool_calls: blocksOf(CLAUDE_BLOCK.TOOL_USE),
      },
    }],
  };
}

/**
 * @param {string} text complete upstream body
 * @returns {object|null} a frame for the peek, or null when the body is not one JSON object
 */
export function jsonDocumentFrame(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let doc;
  // Cut at the last brace to drop a glued "data: [DONE]" trailer.
  try {doc = JSON.parse(trimmed.slice(0, trimmed.lastIndexOf("}") + 1));} catch {return null;}
  if (!isRecord(doc)) return null;
  if (Array.isArray(doc.choices)) return chatFrame(doc);
  const response = [doc, doc.response].find((candidate) => candidate?.object === "response");
  if (response) return responsesFrame(response);
  if (doc.type === "message" && Array.isArray(doc.content)) return claudeFrame(doc);
  return doc;
}
