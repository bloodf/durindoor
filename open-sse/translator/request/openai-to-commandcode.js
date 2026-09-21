/**
 * OpenAI → CommandCode request translator
 *
 * Upstream `/alpha/generate` schema (verified live with curl 2026-05-07):
 *  - params.system: STRING at top level (Anthropic-style; system messages NOT allowed in messages[])
 *  - params.messages[*].role ∈ {"user","assistant","tool"}
 *  - params.messages[*].content: Array of content blocks (NEVER a string)
 *  - tool_use blocks (assistant): {type:"tool-call", toolCallId, toolName, input}
 *  - tool_result blocks (role=user): {type:"tool-result", toolCallId, toolName, output}
 *  - tools[*]: Anthropic plain {name, description, input_schema}
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { DEFAULT_MAX_TOKENS, HTTP_STATUS } from "../../config/runtimeConfig.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { stripThinkingSuffix } from "../concerns/thinkingUnified.js";
import { encodeDataUri, parseDataUri } from "../concerns/image.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function flattenText(content) {
  if (content == null) return "";
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const p of content) {
      if (isString(p)) parts.push(p);else
      if (p && isObject(p) && isString(p.text)) parts.push(p.text);
    }
    return parts.join("\n");
  }
  return String(content);
}

function toContentBlocks(content) {
  if (content == null) return [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  if (isString(content)) return [{ type: OPENAI_BLOCK.TEXT, text: content }];
  if (Array.isArray(content)) {
    const blocks = [];
    for (const part of content) {
      if (isString(part)) {
        blocks.push({ type: OPENAI_BLOCK.TEXT, text: part });
      } else if (part && isObject(part)) {
        if (part.type === OPENAI_BLOCK.TEXT && isString(part.text)) {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
        } else if (part.type === OPENAI_BLOCK.IMAGE_URL || part.type === OPENAI_BLOCK.IMAGE) {
          /** Preserve remote, data-URI, and source-shaped images in CommandCode's native multimodal block. */
          const sourceUrl = part.source?.type === "url" ? part.source.url : null;
          const sourceMediaType = part.source?.type === "base64" && isString(part.source.media_type) ? part.source.media_type : null;
          const sourceData = sourceMediaType && isString(part.source.data) ? encodeDataUri(sourceMediaType, part.source.data) : null;
          const url = isString(part.image_url) ? part.image_url : part.image_url?.url || part.image || part.url || sourceUrl || sourceData;
          if (url) {
            // /alpha/generate's live schema pairs an image with its mimeType; derive
            // it from whichever source matched instead of leaving it unset.
            const mimeType = sourceMediaType || parseDataUri(url)?.mimeType || "image/png";
            blocks.push({ type: "image", image: url, mimeType });
          }
        } else if (isString(part.text)) {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
        }
      }
    }
    return blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  }
  return [{ type: OPENAI_BLOCK.TEXT, text: String(content) }];
}

/** A malformed client history is the caller's fault: chatCore answers these with 400, not 500. */
function invalidRequest(message) {
  const error = new Error(message);
  error.statusCode = HTTP_STATUS.BAD_REQUEST;
  return error;
}

/** Parse an assistant tool-call's arguments; a malformed payload must fail loud, never silently drop input. */
function parseToolInput(value, callId) {
  if (value == null || value === "") return {};

  let input = value;
  if (isString(value)) {
    try {
      input = JSON.parse(value);
    } catch (error) {
      throw invalidRequest(`assistant tool call ${callId || "<unknown>"} has invalid arguments: ${error.message}`);
    }
  }

  if (!input || !isObject(input) || Array.isArray(input)) {
    throw invalidRequest(`assistant tool call ${callId || "<unknown>"} arguments must be a JSON object`);
  }
  return input;
}

function convertMessages(messages = []) {
  const out = [];
  const systemTexts = [];
  const toolNames = new Map();

  for (const m of messages) {
    if (!m) continue;
    const role = m.role;

    if (role === ROLE.SYSTEM || role === ROLE.DEVELOPER) {
      const t = flattenText(m.content);
      if (t) systemTexts.push(t);
      continue;
    }

    if (role === ROLE.TOOL) {
      const toolCallId = m.tool_call_id || "";
      const toolName = m.name || toolNames.get(toolCallId) || "";
      if (!toolCallId) throw invalidRequest("tool message requires tool_call_id");
      if (!toolName) throw invalidRequest(`cannot resolve tool name for tool_call_id ${toolCallId}`);
      const value = isString(m.content) ? m.content : flattenText(m.content);
      out.push({
        role: ROLE.TOOL,
        content: [{
          type: "tool-result",
          toolCallId,
          toolName,
          output: { type: "text", value }
        }]
      });
      continue;
    }

    if (role === ROLE.ASSISTANT) {
      const blocks = [];
      const reasoningText = [m.reasoning_content, m.thought, m.reasoning].find(isString);
      if (reasoningText) blocks.push({ type: "reasoning", text: reasoningText });
      const text = flattenText(m.content);
      if (text) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc.function || {};
          const id = tc.id || "";
          if (!id) throw invalidRequest("assistant tool call requires a non-empty id");
          if (!fn.name) throw invalidRequest(`assistant tool call ${id} requires a non-empty function name`);
          toolNames.set(id, fn.name);
          blocks.push({
            type: "tool-call",
            toolCallId: id,
            toolName: fn.name,
            input: parseToolInput(fn.arguments, id)
          });
        }
      }
      out.push({ role: ROLE.ASSISTANT, content: blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }] });
      continue;
    }

    out.push({ role: ROLE.USER, content: toContentBlocks(m.content) });
  }

  return { messages: out, system: systemTexts.join("\n\n") };
}

/**
 * The CLI's toWireTools sends plain {name, description, input_schema}. A preset
 * `type` makes the gateway skip its input_schema rewrite, so parameters are lost.
 */
function convertTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const result = [];
  for (const t of tools) {
    if (!t) continue;
    if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
      result.push({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object" }
      });
    } else if (t.name && (t.input_schema || t.parameters)) {
      result.push({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema || t.parameters
      });
    }
  }
  return result;
}

export function openaiToCommandCodeRequest(model, body, stream /* , credentials */) {
  const cleanModel = stripThinkingSuffix(model);
  const { messages, system } = convertMessages(body.messages);
  const requestedMaxTokens = body.max_tokens ?? body.max_output_tokens ?? DEFAULT_MAX_TOKENS;
  const safeMaxTokens = Math.max(Number(requestedMaxTokens) || DEFAULT_MAX_TOKENS, 1);
  const maxTokens = Math.min(safeMaxTokens, getCapabilitiesForModel("commandcode", cleanModel).maxOutput);
  const params = {
    model: cleanModel,
    messages,
    tools: convertTools(body.tools),
    stream: stream !== false,
    max_tokens: maxTokens
  };

  if (system) params.system = system;
  // The CLI forwards temperature only when the caller set it; top_p has no wire field.
  if (body.temperature != null) params.temperature = body.temperature;

  const today = new Date().toISOString().slice(0, 10);

  return {
    memory: "",
    // The 1.54 envelope types taste as a nullable object; a string is rejected.
    taste: null,
    skills: null,
    permissionMode: "standard",
    config: {
      workingDir: "/",
      date: today,
      environment: `${process.platform}-${process.arch}, 9router proxy`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: []
    },
    params
  };
}

register(FORMATS.OPENAI, FORMATS.COMMANDCODE, openaiToCommandCodeRequest, null);