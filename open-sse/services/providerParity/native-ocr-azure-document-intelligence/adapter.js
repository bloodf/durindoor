// Azure Document Intelligence OCR adapter spec (#2034), staged and not
// registered. It returns a plain spec for the staged OCR foundation's
// defineOcrAdapter; the registration step defines it and passes it to the
// foundation dispatcher, so this module imports no dispatch code. Source
// attribution is in ./config.js.
//
// The endpoint is per connection (Azure has no global base URL), so a spec is
// built for one configured endpoint and its origin is the only target for the
// submit and every poll. The subscription key goes only to the endpoint of the
// connection it belongs to.
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  AZURE_DI_API_VERSION, AZURE_DI_AUTH_HEADER, AZURE_DI_ENDPOINT_HOST_SUFFIXES, AZURE_DI_FAILED_STATES, AZURE_DI_INLINE_MEDIA_TYPES, AZURE_DI_LABEL,
  AZURE_DI_MODELS, AZURE_DI_OUTPUT_CONTENT_FORMAT, AZURE_DI_PROVIDER_ID, AZURE_DI_RUNNING_STATES, AZURE_DI_SUCCEEDED_STATE,
} from "./config.js";

const RESOURCE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_ENDPOINT_CHARS = 256;
const OPERATION_PATH_RE = /^\/documentintelligence\/documentModels\/[A-Za-z0-9._~-]{1,64}\/analyzeResults\/[A-Za-z0-9._~-]{1,128}$/;

/**
 * The bare https origin of a configured Azure Document Intelligence endpoint,
 * or null. Accepts `https://<resource>.cognitiveservices.azure.com` with an
 * optional trailing slash (and the other allowed host suffixes); refuses any
 * path, query, fragment, userinfo, port or other host.
 */
export function azureDocumentIntelligenceOrigin(value) {
  if (!isString(value) || !value || value.length > MAX_ENDPOINT_CHARS) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.pathname !== "/" || value.replace(/\/$/, "").toLowerCase() !== url.origin) return null;
  const host = url.hostname;
  if (isBlockedHost(host)) return null;
  const suffix = AZURE_DI_ENDPOINT_HOST_SUFFIXES.find((s) => host.endsWith(s));
  if (!suffix || !RESOURCE_LABEL_RE.test(host.slice(0, -suffix.length))) return null;
  return url.origin;
}

/**
 * The selected connection's endpoint origin, or null when none is configured
 * or it is not an Azure endpoint. Source order (resolveOcrCredentials): a
 * top-level `baseUrl` wins over `providerSpecificData.baseUrl`.
 */
export function azureDocumentIntelligenceEndpoint(credentials) {
  if (!isRecord(credentials)) return null;
  const configured = isString(credentials.baseUrl) && credentials.baseUrl.trim()
    ? credentials.baseUrl.trim()
    : isRecord(credentials.providerSpecificData) && isString(credentials.providerSpecificData.baseUrl)
      ? credentials.providerSpecificData.baseUrl.trim()
      : "";
  return configured ? azureDocumentIntelligenceOrigin(configured) : null;
}

/** The analyze URL for one model on one endpoint origin (source AZURE_DI_TRANSFORMATION.buildRequest). */
export function azureDocumentIntelligenceAnalyzeUrl(origin, model) {
  const query = new URLSearchParams({ "api-version": AZURE_DI_API_VERSION, outputContentFormat: AZURE_DI_OUTPUT_CONTENT_FORMAT });
  return `${origin}/documentintelligence/documentModels/${encodeURIComponent(model)}:analyze?${query}`;
}

/** The analyze body: `{ urlSource }` for a remote document, `{ base64Source }` for an inline one (source azureDiSource). */
export function azureDocumentIntelligenceSource(document) {
  if (document?.source === "url" && isString(document.url)) return { urlSource: document.url };
  if (document?.source === "inline" && isString(document.base64) && document.base64) return { base64Source: document.base64 };
  throw new TypeError("Azure Document Intelligence OCR needs a normalized document");
}

/** The OCR poll state for an analyze status answer; throws on a state Azure does not document. */
export function azureDocumentIntelligencePollState(json) {
  const status = isRecord(json) ? json.status : undefined;
  if (status === AZURE_DI_SUCCEEDED_STATE) return "succeeded";
  if (AZURE_DI_RUNNING_STATES.includes(status)) return "running";
  if (AZURE_DI_FAILED_STATES.includes(status)) return "failed";
  throw new TypeError("unknown Azure Document Intelligence analyze status");
}

/**
 * A succeeded analyze answer in the OCR result shape: the whole-document
 * markdown as one aggregated page at index 0 (source parseResponse) and the
 * analyzed page count as usage_info.pages_processed when Azure reports pages.
 * Throws when the answer is not a succeeded result with string content.
 */
export function parseAzureDocumentIntelligenceResult(raw, { model }) {
  if (!isRecord(raw) || raw.status !== AZURE_DI_SUCCEEDED_STATE || !isRecord(raw.analyzeResult)) {
    throw new TypeError("Azure Document Intelligence answer has no succeeded analyzeResult");
  }
  const { content, pages } = raw.analyzeResult;
  if (!isString(content)) throw new TypeError("Azure Document Intelligence analyzeResult has no content");
  const result = { model, pages: [{ index: 0, markdown: content }] };
  if (Array.isArray(pages)) result.usage_info = { pages_processed: pages.length };
  return result;
}

/**
 * The adapter spec for one configured endpoint, to pass to the OCR
 * foundation's defineOcrAdapter.
 *
 * @param {object} args
 * @param {string} args.endpoint the connection's Azure endpoint (see azureDocumentIntelligenceOrigin)
 * @returns {object} spec
 * @throws {TypeError} when the endpoint is not an allowed Azure endpoint
 */
export function azureDocumentIntelligenceOcrSpec({ endpoint } = {}) {
  const origin = azureDocumentIntelligenceOrigin(endpoint);
  if (!origin) throw new TypeError("Azure Document Intelligence OCR needs an https://<resource>.cognitiveservices.azure.com endpoint");

  return {
    id: AZURE_DI_PROVIDER_ID,
    label: AZURE_DI_LABEL,
    origins: [origin],
    models: AZURE_DI_MODELS.map((row) => ({ ...row })),
    inlineMediaTypes: [...AZURE_DI_INLINE_MEDIA_TYPES],
    // The selected connection's own key, and only for the endpoint this spec was built for.
    authHeaders(credentials) {
      if (azureDocumentIntelligenceEndpoint(credentials) !== origin) return null;
      const key = isString(credentials.apiKey) ? credentials.apiKey.trim() : "";
      return key ? { [AZURE_DI_AUTH_HEADER]: key } : null;
    },
    buildRequest({ model, document }) {
      return { url: azureDocumentIntelligenceAnalyzeUrl(origin, model), method: "POST", body: azureDocumentIntelligenceSource(document) };
    },
    // Azure answers 202 with Operation-Location; any other success has no result to read.
    pollUrl(response) {
      const location = response.status === 202 ? response.headers.get("operation-location") : null;
      let url = null;
      try {
        url = location ? new URL(location) : null;
      } catch {
        url = null;
      }
      if (!url || url.origin !== origin || url.username || url.password || url.hash || !OPERATION_PATH_RE.test(url.pathname)) {
        throw new TypeError("Azure Document Intelligence answer has no usable Operation-Location");
      }
      return url.href;
    },
    pollState: azureDocumentIntelligencePollState,
    parseResponse: parseAzureDocumentIntelligenceResult,
  };
}
