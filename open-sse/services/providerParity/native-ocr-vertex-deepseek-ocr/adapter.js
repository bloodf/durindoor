// The vertex-deepseek-ocr adapter on the staged OCR foundation (#2034).
// Source: OmniRoute c71f0065 open-sse/config/ocrRegistry.ts
// (VERTEX_DEEPSEEK_TRANSFORMATION, OCR_PROVIDERS["vertex-deepseek-ocr"]).
//
// The source has no built-in model: callers name their self-deployed
// DeepSeek-OCR model, and the id is sent upstream as supplied. The retired
// managed id is never accepted. The endpoint depends on the connection's
// project and region, so an adapter is defined per selected connection.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { defineOcrAdapter } from "../native-ocr-foundation/index.js";
import {
  VERTEX_DEEPSEEK_OCR_INLINE_MEDIA_TYPES,
  VERTEX_DEEPSEEK_OCR_LABEL,
  VERTEX_DEEPSEEK_OCR_ORIGIN,
  VERTEX_DEEPSEEK_OCR_PROVIDER_ID,
  VERTEX_DEEPSEEK_OCR_RETIRED_MODEL_ID,
  vertexDeepseekOcrPath,
} from "./config.js";

// Deployed model ids: letters, digits and . _ - : @ with "/" between segments.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]*(\/[A-Za-z0-9][A-Za-z0-9._:@-]*)*$/;

/** True when the id names the retired managed model, bare or publisher-qualified. */
export const isRetiredVertexDeepseekOcrModel = (id) =>
  isString(id) && id.split("/").pop().toLowerCase() === VERTEX_DEEPSEEK_OCR_RETIRED_MODEL_ID;

/** Passthrough test for a caller-named deployed model id. */
export const acceptsVertexDeepseekOcrModel = (id) => isString(id) && MODEL_RE.test(id) && !isRetiredVertexDeepseekOcrModel(id);

/**
 * The source request body: one user message with the document as a single
 * image_url content part (document_url documents use the same part).
 */
export function buildVertexDeepseekOcrBody({ model, document }) {
  const url = document.source === "url" ? document.url : document.dataUrl;
  return { model, messages: [{ role: "user", content: [{ type: "image_url", image_url: url }] }] };
}

/**
 * The source parseResponse, narrowed: choices[0].message.content must be a
 * string. A JSON object with a `pages` array is the canonical OCR shape;
 * anything else is one markdown page. `usage` is the fallback usage_info.
 */
export function parseVertexDeepseekOcrResponse(raw, { model } = {}) {
  if (!isRecord(raw) || !Array.isArray(raw.choices) || !raw.choices.length) throw new TypeError("no choices");
  const content = raw.choices[0]?.message?.content;
  if (!isString(content)) throw new TypeError("no text content");
  const answered = isString(raw.model) && raw.model ? raw.model : model;
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null; // Not JSON after all: plain markdown.
    }
    if (isRecord(parsed) && Array.isArray(parsed.pages)) {
      return {
        pages: parsed.pages,
        model: isString(parsed.model) && parsed.model ? parsed.model : answered,
        usage_info: isRecord(parsed.usage_info) ? parsed.usage_info : usage,
      };
    }
  }
  return { pages: [{ index: 0, markdown: content }], model: answered, usage_info: usage };
}

/**
 * Define the adapter for one connection's project and region.
 *
 * @param {{ project: string, region: string, token: string }} scope validated by vertexDeepseekOcrScope
 *   and resolveVertexOcrToken; the token is sent only as this adapter's Bearer header.
 */
export function createVertexDeepseekOcrAdapter({ project, region, token }) {
  const url = `${VERTEX_DEEPSEEK_OCR_ORIGIN}${vertexDeepseekOcrPath(project, region)}`;
  return defineOcrAdapter({
    id: VERTEX_DEEPSEEK_OCR_PROVIDER_ID,
    label: VERTEX_DEEPSEEK_OCR_LABEL,
    origins: [VERTEX_DEEPSEEK_OCR_ORIGIN],
    models: [],
    acceptsModel: acceptsVertexDeepseekOcrModel,
    inlineMediaTypes: VERTEX_DEEPSEEK_OCR_INLINE_MEDIA_TYPES,
    authHeaders: () => (isString(token) && token ? { Authorization: `Bearer ${token}` } : null),
    buildRequest: ({ model, document }) => ({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: buildVertexDeepseekOcrBody({ model, document }),
    }),
    parseResponse: parseVertexDeepseekOcrResponse,
  });
}
