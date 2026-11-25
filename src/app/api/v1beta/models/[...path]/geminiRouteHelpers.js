import { isObject, isString } from "@/shared/utils/typeChecks.js";

/** Parse Gemini actions from the last colon while retaining slash-separated model IDs. */
export function parseGeminiModelPath(path) {
  if (!Array.isArray(path)) return null;
  const joined = path.map((segment) => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  }).filter(Boolean).join('/');
  const match = joined.match(/:(generateContent|streamGenerateContent|countTokens)$/);
  const model = (match ? joined.slice(0, -match[0].length) : joined).trim();
  return model ? { model, action: match?.[0] || ':generateContent' } : null;
}

/** Approximate Gemini input tokens locally, using four characters per token and 258 per media part. */
export function estimateGeminiCountTokens(body) {
  const request = body?.generateContentRequest || body || {};
  let chars = 0;
  let media = 0;
  const add = (value) => { if (value !== undefined) chars += (isString(value) ? value : JSON.stringify(value) || '').length; };
  const content = (item) => {
    for (const part of Array.isArray(item?.parts) ? item.parts : []) {
      if (!part || !isObject(part)) continue;
      add(part.text);
      if (part.functionCall) { add(part.functionCall.name); add(part.functionCall.args); }
      if (part.functionResponse) { add(part.functionResponse.name); add(part.functionResponse.response); }
      add(part.executableCode?.code);
      add(part.codeExecutionResult?.output);
      if (part.inlineData || part.fileData) media += 258;
    }
  };
  if (Array.isArray(request.contents)) request.contents.forEach(content);
  content(request.systemInstruction);
  for (const tool of Array.isArray(request.tools) ? request.tools : []) add(tool?.functionDeclarations);
  return Math.ceil(chars / 4) + media;
}
