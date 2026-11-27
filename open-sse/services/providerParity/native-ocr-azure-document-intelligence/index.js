// Staged, unregistered Azure Document Intelligence native OCR adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
export * from "./config.js";
export {
  azureDocumentIntelligenceAnalyzeUrl, azureDocumentIntelligenceEndpoint, azureDocumentIntelligenceOcrSpec, azureDocumentIntelligenceOrigin,
  azureDocumentIntelligencePollState, azureDocumentIntelligenceSource, parseAzureDocumentIntelligenceResult,
} from "./adapter.js";
