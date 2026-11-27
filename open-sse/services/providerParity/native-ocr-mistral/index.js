// Staged, unregistered Mistral native OCR adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createMistralOcrAdapter } from "./adapter.js";

export * from "./config.js";
export {
  MISTRAL_OCR_OPTIONS, buildMistralOcrRequest, createMistralOcrAdapter, createMistralOcrDispatcher, mistralOcrAuthHeaders, mistralOcrDocument,
  parseMistralOcrResponse, validateMistralOcrPages,
} from "./adapter.js";

/** Default adapter instance, for the OCR core's adapter list at registration. */
export const mistralOcrAdapter = createMistralOcrAdapter();
