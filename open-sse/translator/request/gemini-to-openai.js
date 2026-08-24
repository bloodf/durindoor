import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";

// Convert Gemini request to OpenAI format
import { isString } from "../../../src/shared/utils/typeChecks.js";export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents) {
      const converted = convertGeminiContent(content);
      if (converted) {
        result.messages.push(converted);
      }
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  let reasoningContent = "";

  for (const part of content.parts) {
    if (part.thought === true) {
      if (part.text !== undefined) reasoningContent += part.text;
      continue;
    }

    if (part.text !== undefined) {
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      // Gemini lacks a native call id; derive a deterministic one from the name so the
      // matching functionResponse maps to the same tool_call_id (providers require pairing).
      toolCalls.push({
        id: part.functionCall.id || `call_${part.functionCall.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      return {
        role: ROLE.TOOL,
        tool_call_id: part.functionResponse.id || `call_${part.functionResponse.name}`,
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      };
    }
  }

  if (toolCalls.length > 0) {
    const result = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      result.content = collapseTextParts(parts);
    }
    if (reasoningContent) {
      result.reasoning_content = reasoningContent;
    }
    if (reasoningContent) {
      result.reasoning_content = reasoningContent;
    }
    result.tool_calls = toolCalls;
    return result;
  }

  if (parts.length > 0 || reasoningContent) {
    const result = { role };
    if (parts.length > 0) {
      result.content = collapseTextParts(parts);
    }
    if (reasoningContent) {
      result.reasoning_content = reasoningContent;
    }
    return result;
  }

  return null;
}

// Extract text from Gemini content
function extractGeminiText(content) {
  if (isString(content)) return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map((p) => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);

// Wrapper for geminiToOpenAIRequest that pre-splits contents containing
// functionResponse parts co-located with other content (functionCall, text, etc.).
// The original convertGeminiContent early-returns on the first functionResponse,
// dropping any co-located parts. By splitting each such content into separate
// sub-contents — one per functionResponse (each early-returns cleanly as a tool
// message) and one for the remaining non-functionResponse parts — all co-located
// content is preserved. Tool results are emitted first to match the expected
// message ordering (tool result before the next assistant turn).
function geminiToOpenAIRequestFixed(model, body, stream) {
  if (!body || !Array.isArray(body.contents)) {
    return geminiToOpenAIRequest(model, body, stream);
  }

  const splitContents = [];
  for (const content of body.contents) {
    if (!content || !Array.isArray(content.parts)) {
      splitContents.push(content);
      continue;
    }

    const hasFunctionResponse = content.parts.some((p) => p && p.functionResponse);
    if (!hasFunctionResponse) {
      splitContents.push(content);
      continue;
    }

    for (const part of content.parts) {
      if (part && part.functionResponse) {
        splitContents.push({ ...content, parts: [part] });
      }
    }
    const nonFRParts = content.parts.filter((p) => !(p && p.functionResponse));
    if (nonFRParts.length > 0) {
      splitContents.push({ ...content, parts: nonFRParts });
    }
  }

  return geminiToOpenAIRequest(model, { ...body, contents: splitContents }, stream);
}

// Override registration to use the fixed version (Map.set: last wins)
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequestFixed, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequestFixed, null);