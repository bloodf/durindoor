import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { DEFAULT_SAFETY_SETTINGS, tryParseJSON, sanitizeFunctionResponseResult } from "../formats/gemini.js";
import { ROLE, GEMINI_ROLE, CLAUDE_BLOCK, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildGeminiThoughtSignatureKey, resolveGeminiThoughtSignature } from "../../services/geminiThoughtSignatureStore.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

function sanitizeGeminiToolName(name, toolNameMap) {
  let sanitized = String(name || "_unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) sanitized = `_${sanitized}`;
  sanitized = sanitized.slice(0, 64);
  toolNameMap.set(sanitized, name);
  return sanitized;
}

function historicalToolResult(name, content) {
  return `[Historical tool result for ${name}]: ${content}`;
}

export function claudeToGeminiRequest(model, body, stream, credentials = null) {
  const toolNameMap = new Map();
  const sanitize = (name) => sanitizeGeminiToolName(name, toolNameMap);
  const provider = credentials?._provider;
  const stripFunctionCallId = provider === "vertex" || provider === "vertex-partner";
  const signatureNamespace = isString(credentials?._signatureNamespace) ? credentials._signatureNamespace : null;
  const result = {
    model,
    contents: [],
    generationConfig: {},
    safetySettings: body.safetySettings || DEFAULT_SAFETY_SETTINGS
  };

  for (const [source, target] of [["temperature", "temperature"], ["top_p", "topP"], ["top_k", "topK"]]) {
    if (body[source] !== undefined) result.generationConfig[target] = body[source];
  }
  if (body.max_tokens !== undefined) result.generationConfig.maxOutputTokens = body.max_tokens;
  if (body.system) {
    const text = Array.isArray(body.system) ? body.system.map((entry) => entry.text || "").join("\n") : String(body.system);
    if (text) result.systemInstruction = { role: GEMINI_ROLE.USER, parts: [{ text }] };
  }

  const toolUseNames = {};
  const signatures = new Map();
  for (const message of body.messages || []) {
    if (message.role !== ROLE.ASSISTANT || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== CLAUDE_BLOCK.TOOL_USE || !block.id || !block.name) continue;
      toolUseNames[block.id] = sanitize(block.name);
      const clientSignature = isString(block.thoughtSignature) && block.thoughtSignature ||
      isString(block.thought_signature) && block.thought_signature;
      const signature = resolveGeminiThoughtSignature(buildGeminiThoughtSignatureKey(signatureNamespace, block.id), clientSignature);
      if (signature) signatures.set(block.id, signature);
    }
  }

  for (const message of body.messages || []) {
    const parts = [];
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === CLAUDE_BLOCK.TEXT && block.text) parts.push({ text: block.text });else
        if (block.type === CLAUDE_BLOCK.THINKING && block.thinking) parts.push({ thought: true, text: block.thinking });else
        if (block.type === CLAUDE_BLOCK.IMAGE && block.source?.type === "base64") parts.push({ inlineData: { mimeType: block.source.media_type || DEFAULT_IMAGE_MIME, data: block.source.data } });else
        if (block.type === CLAUDE_BLOCK.TOOL_USE) {
          const signature = signatures.get(block.id);
          parts.push({ ...(signature ? { thoughtSignature: signature } : null), functionCall: { ...(stripFunctionCallId ? null : { id: block.id }), name: sanitize(block.name), args: block.input || {} } });
        } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
          let content = block.content;
          if (Array.isArray(content)) content = content.map((entry) => entry.type === CLAUDE_BLOCK.TEXT ? entry.text : JSON.stringify(entry)).join("\n");
          const name = toolUseNames[block.tool_use_id] || "unknown";
          if (!signatures.has(block.tool_use_id)) {
            parts.push({ text: historicalToolResult(name, content) });
            continue;
          }
          let parsed = sanitizeFunctionResponseResult(tryParseJSON(content));
          if (parsed === null || !isObject(parsed)) parsed = { result: parsed === null ? content : parsed };
          parts.push({ functionResponse: { ...(stripFunctionCallId ? null : { id: block.tool_use_id }), name, response: { result: parsed } } });
        }
      }
    } else if (isString(message.content) && message.content) parts.push({ text: message.content });
    if (parts.length) result.contents.push({ role: message.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER, parts });
  }

  const declarations = (body.tools || []).flatMap((tool) => tool?.name && tool.input_schema ? [{ name: sanitize(tool.name), description: tool.description || "", parameters: tool.input_schema }] : []);
  if (declarations.length) result.tools = [{ functionDeclarations: declarations }];

  result._toolNameMap = new Map([...toolNameMap].map(([sanitized, original]) => [sanitized.toLowerCase(), original]));
  return result;
}

register(FORMATS.CLAUDE, FORMATS.GEMINI, claudeToGeminiRequest, null);