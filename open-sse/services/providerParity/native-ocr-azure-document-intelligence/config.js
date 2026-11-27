// Azure Document Intelligence native OCR adapter: constants and source
// attribution, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/ocrRegistry.ts (the "azure-document-intelligence" entry of
// OCR_PROVIDERS: empty base URL, apikey auth sent as Ocp-Apim-Subscription-Key,
// the single "prebuilt-read" model; AZURE_DI_TRANSFORMATION: POST
// {endpoint}/documentintelligence/documentModels/{model}:analyze with
// api-version=2024-11-30 and outputContentFormat=markdown, a body of
// { urlSource } or { base64Source }, the Operation-Location poll URL, and
// analyzeResult.content mirrored into one aggregated page with
// usage_info.pages_processed) and open-sse/handlers/ocr.ts (handleOcr and
// pollOcrOperation: same-origin poll with the same key header, status
// "succeeded" / "failed", 30 polls one second apart). The connection endpoint
// comes from the selected connection (src/app/api/v1/ocr/route.ts
// resolveOcrCredentials: top-level baseUrl, else providerSpecificData.baseUrl).

export const AZURE_DI_PROVIDER_ID = "azure-document-intelligence";
export const AZURE_DI_LABEL = "Azure Document Intelligence";

/** Source AZURE_DI_API_VERSION. */
export const AZURE_DI_API_VERSION = "2024-11-30";
/** Source query: the whole-document content is returned as markdown. */
export const AZURE_DI_OUTPUT_CONTENT_FORMAT = "markdown";
/** Source auth header (registry authHeader). */
export const AZURE_DI_AUTH_HEADER = "Ocp-Apim-Subscription-Key";

/** Source registry models: only the Read model is listed. */
export const AZURE_DI_MODELS = Object.freeze([
  Object.freeze({ id: "prebuilt-read", name: "Azure Document Intelligence (Read)" }),
]);

/**
 * Inline (base64Source) media types sent to Azure. The OCR foundation also
 * accepts WebP and GIF, which the Read model does not take, so they are
 * refused before anything is sent.
 */
export const AZURE_DI_INLINE_MEDIA_TYPES = Object.freeze(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);

/**
 * Host suffixes a configured endpoint may use: the Azure AI services resource
 * subdomain in the public, US Government and China clouds, and the regional
 * multi-service endpoint. The subscription key is sent to no other host.
 */
export const AZURE_DI_ENDPOINT_HOST_SUFFIXES = Object.freeze([
  ".cognitiveservices.azure.com",
  ".cognitiveservices.azure.us",
  ".cognitiveservices.azure.cn",
  ".api.cognitive.microsoft.com",
]);

/** Azure analyze job states, by the OCR poll state they map to. */
export const AZURE_DI_RUNNING_STATES = Object.freeze(["notStarted", "running"]);
export const AZURE_DI_FAILED_STATES = Object.freeze(["failed", "canceled"]);
export const AZURE_DI_SUCCEEDED_STATE = "succeeded";
