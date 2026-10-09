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
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import { DEFAULT_MIN_TOKENS, HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * Cursor's current protobuf encoder carries text and tool results, not images.
 * Reject image input before normalization, modality stripping, or RTK can erase
 * it. Inspect explicit message image fields, attachment metadata, content blocks,
 * inline image data URIs in message strings, and Responses tool-output arrays,
 * never arbitrary tool JSON or schemas. Inline recognition mirrors modality.js;
 * text blocks and nested strings are not scanned by its inline stripper. Empty
 * image fields are not input. Untyped attachments require image MIME/data URLs
 * or a known image URL extension when MIME is absent; ambiguous URLs and raw
 * data are allowed without fetching. Leave the body untouched; statusCode feeds
 * chatCore's client-error handling.
 */
export function validateCursorImages(body) {
  function rejectImage() {
    const error = new Error("Cursor image input is not supported by this transport. Remove images or use a vision-capable provider.");
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  function hasImageValue(value) {
    if (isString(value)) return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(hasImageValue);
    if (value !== null && isObject(value)) return Object.values(value).some(hasImageValue);
    return false;
  }
  function isImageExtensionInUrl(value) {
    if (!isString(value)) return false;
    try {
      return /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|avif|heic|heif|tiff?)$/i.test(new URL(value).pathname);
    } catch {
      return false;
    }
  }
  function visitBlocks(blocks) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || !isObject(block)) continue;
      const mimeType = block.inlineData?.mimeType || block.inline_data?.mime_type ||
        block.fileData?.mimeType || block.file_data?.mime_type;
      if (block.type === OPENAI_BLOCK.IMAGE_URL ||
          block.type === CLAUDE_BLOCK.IMAGE ||
          block.type === RESPONSES_ITEM.INPUT_IMAGE ||
          (isString(mimeType) && mimeType.startsWith("image/"))) rejectImage();
      // Only Claude tool-result content is another protocol block array.
      if (block.type === CLAUDE_BLOCK.TOOL_RESULT) visitBlocks(block.content);
    }
  }
  function visitMessages(messages, checkInlineImages = false) {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (!message || !isObject(message)) continue;
      if (checkInlineImages && isString(message.content)) {
        // Keep the full URI matcher identical to replaceUnsupportedDataUris.
        for (const match of message.content.matchAll(/data:([^;,:]{1,255})(?:;base64)?,[^\s)]+/gi)) {
          if (match[1].toLowerCase().startsWith("image/")) rejectImage();
        }
      }
      if (hasImageValue(message.images) || hasImageValue(message.image) || hasImageValue(message.image_url)) rejectImage();
      for (const field of ["attachments", "experimental_attachments"]) {
        if (!Array.isArray(message[field])) continue;
        for (const attachment of message[field]) {
          const mimeType = attachment?.contentType || attachment?.mediaType ||
            (isString(attachment?.url) && attachment.url.match(/^data:([^;,:]{1,255})/)?.[1]);
          if ((isString(mimeType) && mimeType.startsWith("image/")) ||
              (!mimeType && isImageExtensionInUrl(attachment?.url))) rejectImage();
        }
      }
      visitBlocks(message.content);
      visitBlocks(message.parts);
    }
  }
  visitMessages(body.messages, true);
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item?.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) visitBlocks(item.output);
      else if (item?.type === RESPONSES_ITEM.MESSAGE || item?.role) visitMessages([item]);
    }
  }
  visitMessages(body.contents);
  visitMessages(body.request?.contents);
}

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

export function openaiToCursorRequest(model, body, stream, credentials) {
  validateCursorImages(body);
  const messages = convertMessages(body.messages || []);

  // Strip fields irrelevant to Cursor (OpenAI/Anthropic-specific)
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;

  return {
    ...rest,
    messages,
    max_tokens: DEFAULT_MIN_TOKENS
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, openaiToCursorRequest, null);