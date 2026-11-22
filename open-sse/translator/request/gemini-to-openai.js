import { createHash } from "node:crypto";
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";

// Convert Gemini request to OpenAI format
import { isString } from "../../../src/shared/utils/typeChecks.js";
export function geminiToOpenAIRequest(model, body, stream) {
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
    const ids = { serialByName: new Map(), queueByName: new Map() };
    for (const content of body.contents) {
      const converted = convertGeminiContent(content, ids);
      if (converted) {
        if (Array.isArray(converted)) result.messages.push(...converted);
        else result.messages.push(converted);
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
              parameters: func.parameters || func.parametersJsonSchema || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  // toolConfig → tool_choice (inverse of openai-to-gemini). VALIDATED has no OpenAI
  // equivalent; it is closest to "auto" (model may answer or call, args schema-checked).
  const fcc = body.toolConfig?.functionCallingConfig;
  if (result.tools?.length && fcc?.mode) {
    const names = fcc.allowedFunctionNames;
    if (fcc.mode === "NONE") result.tool_choice = "none";
    else if (fcc.mode === "AUTO" || fcc.mode === "VALIDATED") result.tool_choice = "auto";
    else if (fcc.mode === "ANY") {
      // OpenAI has no allow-list: declare only the allowed tools. Names matching no declared
      // tool are ignored (keep every tool) so "required" never ships with an empty tool list.
      const allowed = names?.length ? result.tools.filter((t) => names.includes(t.function.name)) : [];
      if (allowed.length) result.tools = allowed;
      result.tool_choice = result.tools.length === 1 && allowed.length
        ? { type: OPENAI_BLOCK.FUNCTION, function: { name: result.tools[0].function.name } }
        : "required";
    }
  }

  return result;
}

// Anthropic/OpenAI id patterns reject dots etc. Sanitize generated and client ids the same
// way on both sides of a pair; add a hash when sanitizing changed the value so
// `ns.search` and `ns_search` stay distinct.
const safeId = (raw) => {
  const text = String(raw);
  const clean = text.replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean === text ? text : `${clean}_${createHash("sha1").update(text).digest("hex").slice(0, 8)}`;
};
const generatedCallId = (name) => safeId(`call_${name}`);
const callId = (id, name) => (id ? safeId(id) : generatedCallId(name));

// Same-turn calls to one function without ids get a serial suffix; idless responses
// consume the queued ids in order (mirrors the /v1beta bridge).
function nextCallId({ serialByName, queueByName }, call) {
  const name = call.name;
  let id;
  if (call.id) id = safeId(call.id);
  else {
    const serial = (serialByName.get(name) || 0) + 1;
    serialByName.set(name, serial);
    id = serial === 1 ? generatedCallId(name) : safeId(`call_${name}_${serial}`);
  }
  queueByName.set(name, [...(queueByName.get(name) || []), id]);
  return id;
}

function responseCallId({ queueByName }, response) {
  if (response.id) return safeId(response.id);
  const queue = queueByName.get(response.name) || [];
  return queue.shift() ?? generatedCallId(response.name);
}

/**
 * OpenAI role of a Gemini content. Older clients send `function` or `tool` for tool results
 * sent as the user's turn, and single-turn requests omit the role: those map to user, with an
 * omitted role inferred from the parts (functionCall or thought parts mean the model spoke).
 * Any other explicit role (`model`) stays assistant.
 */
function geminiTurnRole(content) {
  const role = isString(content?.role) ? content.role.trim().toLowerCase() : "";
  if (role === GEMINI_ROLE.USER || role === "function" || role === "tool") return ROLE.USER;
  if (role) return ROLE.ASSISTANT;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.some((part) => part && (part.functionCall || part.thought === true)) ? ROLE.ASSISTANT : ROLE.USER;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content, ids = { serialByName: new Map(), queueByName: new Map() }) {
  // A reply pairs with the calls of the turn just before it: each model turn with calls starts a fresh pairing queue (the serial stays global so ids are unique across the history).
  if (content?.parts?.some?.((part) => part?.functionCall)) {
    ids.queueByName.clear();
  }
  const role = geminiTurnRole(content);

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  const toolResults = [];
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

    if (isString(part.fileData?.fileUri) && part.fileData.fileUri) {
      // Translate Gemini fileData URI into an OpenAI image_url part (#2185).
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: part.fileData.fileUri
        }
      });
    }

    if (part.functionCall) {
      // Gemini lacks a native call id; derive a deterministic one from the name so the
      // matching functionResponse maps to the same tool_call_id (providers require pairing).
      toolCalls.push({
        id: nextCallId(ids, part.functionCall),
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      // Return string response.result directly (avoid double-encoding), JSON-stringify
      // defined non-string response.result (including 0/false/null), else JSON of response (#2185).
      const resp = part.functionResponse.response;
      const toolContent = resp && resp.result !== undefined
        ? (isString(resp.result) ? resp.result : JSON.stringify(resp.result))
        : JSON.stringify(resp ?? {});
      toolResults.push({
        role: ROLE.TOOL,
        tool_call_id: responseCallId(ids, part.functionResponse),
        content: toolContent
      });
    }
  }

  let message = null;
  if (toolCalls.length || parts.length || reasoningContent) {
    message = { role: toolCalls.length ? ROLE.ASSISTANT : role };
    if (parts.length) message.content = toolResults.length && !toolCalls.length ? parts : collapseTextParts(parts);
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length) message.tool_calls = toolCalls;
  }

  // Complete the parts scan before returning: parallel results must all precede
  // any co-located follow-up text or calls in the OpenAI message sequence.
  if (toolResults.length > 0) {
    return message ? [...toolResults, message] : toolResults;
  }
  return message;
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