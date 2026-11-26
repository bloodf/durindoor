import { register } from "../registry.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";
import { budgetToEffort } from "../concerns/thinking.js";
import { collapseTextParts } from "../concerns/message.js";
import { applyGeminiStopSequences, applyGeminiToolChoice, geminiTurnRole } from "./gemini-to-openai.js";

// Convert Antigravity request to OpenAI format
// Antigravity body: { project, model, userAgent, requestType, requestId, request: { contents, systemInstruction, tools, toolConfig, generationConfig, sessionId } }
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
export function antigravityToOpenAIRequest(model, body, stream) {
  const req = body.request || body;
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (req.generationConfig) {
    const config = req.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: req.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
    if (config.topK !== undefined) {
      result.top_k = config.topK;
    }

    // Thinking config → reasoning_effort
    if (config.thinkingConfig) {
      const effort = budgetToEffort(config.thinkingConfig.thinkingBudget || 0);
      if (effort) result.reasoning_effort = effort;
    }
    applyGeminiStopSequences(result, config);
  }

  // System instruction
  if (req.systemInstruction) {
    const systemText = extractText(req.systemInstruction);
    if (systemText) {
      result.messages.push({ role: ROLE.SYSTEM, content: systemText });
    }
  }

  // Convert contents to messages
  if (req.contents && Array.isArray(req.contents)) {
    for (const content of req.contents) {
      const converted = convertContent(content);
      if (converted) {
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  // Tools
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: normalizeSchemaTypes(func.parameters || func.parametersJsonSchema) || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  applyGeminiToolChoice(result, req.toolConfig);

  return result;
}

/**
 * Recursively normalize an Antigravity/Gemini tool-parameter schema for the
 * OpenAI-shaped tool surface: lowercase `type` keywords (OBJECT -> object), convert
 * safe ProtoJSON int64 schema constraints to numbers, strip unsupported fields
 * (e.g. `enumDescriptions`), remove property defaults, recurse through nested values, and add a placeholder
 * `properties` map to bare object nodes (Gemini rejects those without properties).
 *
 * @param {object} schema - Antigravity tool parameter schema.
 * @returns {object} Normalized schema (a shallow-cloned tree).
 */
const PROTOJSON_INT64_SCHEMA_KEYS = new Set(["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]);

function normalizeSchemaTypes(schema) {
  if (Array.isArray(schema)) return schema.map(normalizeSchemaTypes);
  if (!schema || !isObject(schema)) return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enumDescriptions") continue;
    if (key === "type" && isString(value)) { result[key] = value.toLowerCase(); continue; }
    if (PROTOJSON_INT64_SCHEMA_KEYS.has(key) && isString(value) && /^\d+$/.test(value.trim())) {
      const parsed = Number(value);
      result[key] = Number.isSafeInteger(parsed) ? parsed : value;
      continue;
    }
    if (key === "properties" && isObject(value) && !Array.isArray(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, property]) => {
        if (!property || !isObject(property) || Array.isArray(property)) return [name, normalizeSchemaTypes(property)];
        const { default: _default, ...rest } = property;
        return [name, normalizeSchemaTypes(rest)];
      }));
      continue;
    }
    result[key] = normalizeSchemaTypes(value);
  }

  // Gemini rejects type:object without properties — add placeholder to satisfy API
  if (result.type === "object" && (!result.properties || Object.keys(result.properties).length === 0)) {
    result.properties = { _: { type: "string" } };
  }

  return result;
}

// Convert Antigravity content to OpenAI message
// Handles: text, thought, thoughtSignature, functionCall, functionResponse, inlineData
function convertContent(content) {
  // The Gemini role is optional; the Gemini translator's rule applies here too.
  const role = geminiTurnRole(content);

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const textParts = [];
  const toolCalls = [];
  const toolResults = [];
  let reasoningContent = "";

  // Gemini calls may carry no id. Derive one from the name and its occurrence, so
  // parallel calls to one tool stay distinct and each response still pairs (upstream #4511).
  const callCounts = new Map();
  const responseCounts = new Map();
  const deriveId = (name, counts) => {
    const seen = counts.get(name) || 0;
    counts.set(name, seen + 1);
    return seen === 0 ? `call_${name}` : `call_${name}_${seen}`;
  };

  for (const part of content.parts) {
    // Thinking content (thought: true)
    if (part.thought === true && part.text) {
      reasoningContent += part.text;
      continue;
    }

    // Text with thoughtSignature = regular text after thinking
    if (part.thoughtSignature && part.text !== undefined) {
      if (part.text) {
        textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
      }
      continue;
    }

    // Regular text
    if (part.text !== undefined && part.text !== "") {
      textParts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    // Inline data (images)
    if (part.inlineData) {
      textParts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    // File reference, carried like the Gemini translator does
    if (isString(part.fileData?.fileUri) && part.fileData.fileUri) {
      textParts.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: part.fileData.fileUri } });
    }

    // Function call
    if (part.functionCall) {
      toolCalls.push({
        // Deterministic id so the matching functionResponse pairs correctly.
        id: part.functionCall.id || deriveId(part.functionCall.name, callCounts),
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    // Function response → collect all, each becomes a separate tool message
    if (part.functionResponse) {
      toolResults.push({
        role: ROLE.TOOL,
        tool_call_id: part.functionResponse.id || deriveId(part.functionResponse.name, responseCounts),
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  // Content with functionResponses — return array of tool result messages,
  // plus an assistant message for any co-located tool calls / text.
  if (toolResults.length > 0) {
    if (toolCalls.length > 0 || textParts.length > 0 || reasoningContent) {
      // A user turn can carry a tool result plus a follow-up: keep the follow-up a user message.
      const assistantMsg = { role: toolCalls.length > 0 ? ROLE.ASSISTANT : role };
      if (textParts.length > 0) {
        assistantMsg.content = collapseTextParts(textParts);
      }
      if (reasoningContent) {
        assistantMsg.reasoning_content = reasoningContent;
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      // Results must follow the assistant message that makes the calls.
      return toolCalls.length > 0 ? [assistantMsg, ...toolResults] : [...toolResults, assistantMsg];
    }
    return toolResults;
  }

  // Assistant with tool calls
  if (toolCalls.length > 0) {
    const msg = { role: ROLE.ASSISTANT };
    if (textParts.length > 0) {
      msg.content = collapseTextParts(textParts);
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    msg.tool_calls = toolCalls;
    return msg;
  }

  // Regular message
  if (textParts.length > 0 || reasoningContent) {
    const msg = { role };
    if (textParts.length > 0) {
      msg.content = collapseTextParts(textParts);
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    return msg;
  }

  return null;
}

// Extract text from systemInstruction
function extractText(instruction) {
  if (isString(instruction)) return instruction;
  if (instruction.parts && Array.isArray(instruction.parts)) {
    return instruction.parts.map((p) => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, antigravityToOpenAIRequest, null);
