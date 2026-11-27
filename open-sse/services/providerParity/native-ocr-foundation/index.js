// Staged, unregistered native OCR dispatch foundation (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
export * from "./config.js";
export { OCR_POLL_STATES, defineOcrAdapter } from "./adapter.js";
export { normalizeOcrDocument, ocrReject, resolveOcrModel, validateOcrRequest } from "./request.js";
export { ocrAcceptedJob, ocrRefusal } from "./http.js";
export { createOcrDispatcher, normalizeOcrResult, ocrAccounting } from "./core.js";
