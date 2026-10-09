/**
 * OpenAI to Cursor Request Translator
 * Converts OpenAI messages to Cursor ask/agent format.
 *
 * Important: Cursor can loop when tool outputs are sent via protobuf tool_results
 * with partial schema mismatches. For stability, tool outputs are represented as
 * structured text blocks in user messages.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function extractContent(content) {
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content.
    filter((part) => {
      if (!part || !isObject(part)) return false;
      return part.type === OPENAI_BLOCK.TEXT && isString(part.text);
    }).
    map((part) => part.text || "").
    join("");
  }
  return "";
}

function sanitizeToolResultText(text) {
  // Strip non-printable control chars that can produce backend request errors
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildToolResultBlock(toolName, toolCallId, resultText) {
  const cleanResult = sanitizeToolResultText(resultText || "");
  return [
  "<tool_result>",
  `<tool_name>${escapeXml(toolName || "tool")}</tool_name>`,
  `<tool_call_id>${escapeXml(toolCallId || "")}</tool_call_id>`,
  `<result>${escapeXml(cleanResult)}</result>`,
  "</tool_result>"].
  join("\n");
}

function normalizeToolCallId(id) {
  return isString(id) ? id.split("\n")[0] : "";
}

function convertMessages(messages) {
  const result = [];

  // Build a map of tool_call_id -> tool name from assistant tool calls
  const toolCallMetaMap = new Map();
  const rememberToolMeta = (toolCallId, toolName) => {
    if (!toolCallId) return;
    const name = toolName || "tool";
    toolCallMetaMap.set(toolCallId, { name });
    const normalized = normalizeToolCallId(toolCallId);
    if (normalized && normalized !== toolCallId) {
      toolCallMetaMap.set(normalized, { name });
    }
  };

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        rememberToolMeta(tc.id || "", tc.function?.name || "tool");
      }
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== CLAUDE_BLOCK.TOOL_USE) continue;
        rememberToolMeta(part.id || "", part.name || "tool");
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === ROLE.SYSTEM) {
      result.push({
        role: ROLE.USER,
        content: `[System Instructions]\n${extractContent(msg.content)}`
      });
      continue;
    }

    if (msg.role === ROLE.TOOL) {
      const toolContent = extractContent(msg.content);
      const toolCallId = msg.tool_call_id || "";
      const toolMeta = toolCallMetaMap.get(toolCallId) || {};
      const toolName = msg.name || toolMeta.name || "tool";
      result.push({
        role: ROLE.USER,
        content: buildToolResultBlock(toolName, toolCallId, toolContent)
      });
      continue;
    }

    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.USER && Array.isArray(msg.content)) {
        const parts = [];
        for (const block of msg.content) {
          if (!block || !isObject(block)) continue;
          if (block.type === CLAUDE_BLOCK.TEXT) {
            if (isString(block.text)) {
              parts.push(block.text || "");
            }
            continue;
          }
          if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            const toolCallId = block.tool_use_id || "";
            const toolMeta =
            toolCallMetaMap.get(toolCallId) ||
            toolCallMetaMap.get(normalizeToolCallId(toolCallId));
            const toolName = toolMeta?.name || "tool";
            const toolContent = extractContent(block.content);
            parts.push(buildToolResultBlock(toolName, toolCallId, toolContent));
          }
        }
        const joined = parts.filter(Boolean).join("\n");
        if (joined) result.push({ role: ROLE.USER, content: joined });
        continue;
      }

      const content = extractContent(msg.content);

      if (msg.role === ROLE.ASSISTANT && msg.tool_calls && msg.tool_calls.length > 0) {
        const assistantMsg = { role: ROLE.ASSISTANT, content: content || "" };
        assistantMsg.tool_calls = msg.tool_calls.map((tc) => {
          const { index, ...rest } = tc || {};
          return rest;
        });
        result.push(assistantMsg);
      } else if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
        const extractedToolCalls = msg.content.
        filter((b) => b?.type === CLAUDE_BLOCK.TOOL_USE).
        map((b) => ({
          id: b.id || "",
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: b.name || "tool",
            arguments: JSON.stringify(b.input || {})
          }
        })).
        filter((tc) => tc.id);

        if (extractedToolCalls.length > 0) {
          result.push({
            role: ROLE.ASSISTANT,
            content: content || "",
            tool_calls: extractedToolCalls
          });
        } else if (content) {
          result.push({ role: ROLE.ASSISTANT, content });
        }
      } else {
        if (content) {
          result.push({ role: msg.role, content });
        }
      }
    }
  }

  return result;
}

/**
 * The current Cursor executor/protobuf encoder has no output-token cap field,
 * for either streaming or buffered responses. Reject explicit caps with HTTP
 * 400 rather than silently discard them or advertise an unenforced default.
 * As with legacy OpenAI targets, a defined max_tokens takes precedence over
 * max_completion_tokens. The selected value must be a positive integer;
 * null is invalid, while undefined means absent. Uncapped requests stay uncapped.
 * Same-format requests bypass this adapter in translateRequest.
 */
export function openaiToCursorRequest(model, body, stream, credentials) {
  const capField = body.max_tokens !== undefined ? "max_tokens" : "max_completion_tokens";
  const cap = body[capField];
  if (cap !== undefined) {
    const error = new Error(!Number.isInteger(cap) || cap < 1 ?
      `${capField} must be a positive integer` :
      `Cursor transport does not support ${capField}; explicit output-token limits cannot be enforced`);
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }

  const messages = convertMessages(body.messages || []);

  // Strip fields irrelevant to Cursor (OpenAI/Anthropic-specific)
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;

  return {
    ...rest,
    messages
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, openaiToCursorRequest, null);