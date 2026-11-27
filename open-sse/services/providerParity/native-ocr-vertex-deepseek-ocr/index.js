// Staged, unregistered vertex-deepseek-ocr OCR adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
export * from "./config.js";
export {
  acceptsVertexDeepseekOcrModel,
  buildVertexDeepseekOcrBody,
  createVertexDeepseekOcrAdapter,
  isRetiredVertexDeepseekOcrModel,
  parseVertexDeepseekOcrResponse,
} from "./adapter.js";
export { defaultVertexOcrTokenMinter, resolveVertexOcrToken, vertexDeepseekOcrScope } from "./auth.js";
export { runVertexDeepseekOcr } from "./ocr.js";
