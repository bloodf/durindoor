// Azure Document Intelligence native OCR adapter, staged and unregistered
// (#2034). Closed mocks only: every request goes to an injected transport that
// fails the test on anything unexpected, endpoints are synthetic Azure-shaped
// hosts and every key is synthetic. Source: OmniRoute c71f0065
// open-sse/config/ocrRegistry.ts (AZURE_DI_TRANSFORMATION, the
// azure-document-intelligence OCR_PROVIDERS entry) and open-sse/handlers/ocr.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createOcrDispatcher, defineOcrAdapter, validateOcrRequest } from "../../open-sse/services/providerParity/native-ocr-foundation/index.js";
import * as azure from "../../open-sse/services/providerParity/native-ocr-azure-document-intelligence/index.js";
import {
  AZURE_DI_API_VERSION,
  azureDocumentIntelligenceAnalyzeUrl,
  azureDocumentIntelligenceEndpoint,
  azureDocumentIntelligenceOcrSpec,
  azureDocumentIntelligenceOrigin,
  azureDocumentIntelligencePollState,
  azureDocumentIntelligenceSource,
  parseAzureDocumentIntelligenceResult,
} from "../../open-sse/services/providerParity/native-ocr-azure-document-intelligence/index.js";

const ROOT = new URL("../../", import.meta.url);
const MODULE_DIR = "open-sse/services/providerParity/native-ocr-azure-document-intelligence";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${MODULE_DIR}/registration.json`, ROOT), "utf8"));

const PROVIDER = "azure-document-intelligence";
const ENDPOINT = "https://synthres.cognitiveservices.azure.com";
const OTHER_ENDPOINT = "https://otherres.cognitiveservices.azure.com";
const ANALYZE_URL = `${ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&outputContentFormat=markdown`;
const OP_URL = `${ENDPOINT}/documentintelligence/documentModels/prebuilt-read/analyzeResults/op-0001?api-version=2024-11-30`;
const KEY_A = "SYNTHETIC-azure-di-key-a-0001";
const KEY_B = "SYNTHETIC-azure-di-key-b-0002";
const DOC_URL = "https://files.example.org/report.pdf";
const PDF_B64 = Buffer.from("%PDF-1.7 synthetic").toString("base64");
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
const TIFF_B64 = Buffer.from([0x49, 0x49, 0x2a, 0x00, 9, 9]).toString("base64");

const CRED_A = { apiKey: KEY_A, providerSpecificData: { baseUrl: `${ENDPOINT}/` }, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, providerSpecificData: { baseUrl: ENDPOINT }, connectionId: "conn-b" };

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (location = OP_URL) => new Response(null, { status: 202, headers: location ? { "operation-location": location } : {} });
const leaky = (status, headers = {}) => json({ error: { code: "Synthetic", message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const running = (status = "running") => json({ status, createdDateTime: "2026-11-27T00:00:00Z" });
const SUCCEEDED = {
  status: "succeeded",
  analyzeResult: {
    apiVersion: AZURE_DI_API_VERSION,
    modelId: "prebuilt-read",
    content: "# Report\n\nfirst page\n<!-- PageBreak -->\nsecond page",
    pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }],
  },
};
const hang = () => new Promise(() => {});

/** Closed transport: answers in order, records each call, rejects anything beyond the script. */
function transport(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

function dispatcher(answers, { endpoint = ENDPOINT, sleepImpl, ...options } = {}) {
  const t = transport(...answers);
  const sleeps = [];
  const adapter = defineOcrAdapter(azureDocumentIntelligenceOcrSpec({ endpoint }));
  const d = createOcrDispatcher({ adapters: [adapter], fetchImpl: t.fetchImpl, sleepImpl: sleepImpl ?? (async (ms) => void sleeps.push(ms)), ...options });
  const dispatch = (body, credentials = CRED_A, extra = {}) => d.dispatch({ provider: PROVIDER, body, credentials, ...extra });
  return { ...t, sleeps, adapter, dispatch };
}

const urlBody = (extra = {}) => ({ model: "prebuilt-read", document: { type: "document_url", document_url: DOC_URL }, ...extra });
const inlineBody = (mediaType, b64, field = "document_url") => ({ model: "prebuilt-read", document: { [field]: `data:${mediaType};base64,${b64}` } });

async function expectNoLeak(result) {
  const text = `${result.error ?? ""} ${result.response ? await result.response.clone().text() : ""}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("/srv/app");
}

describe("Azure endpoint configuration", () => {
  it.each([
    [ENDPOINT, ENDPOINT],
    [`${ENDPOINT}/`, ENDPOINT],
    ["https://SynthRes.CognitiveServices.Azure.com/", ENDPOINT],
    ["https://gov-res.cognitiveservices.azure.us", "https://gov-res.cognitiveservices.azure.us"],
    ["https://cn-res.cognitiveservices.azure.cn/", "https://cn-res.cognitiveservices.azure.cn"],
    ["https://westeurope.api.cognitive.microsoft.com/", "https://westeurope.api.cognitive.microsoft.com"],
  ])("accepts %s", (value, origin) => {
    expect(azureDocumentIntelligenceOrigin(value)).toBe(origin);
  });

  it.each([
    "http://synthres.cognitiveservices.azure.com",
    `${ENDPOINT}/documentintelligence`,
    `${ENDPOINT}/?x=1`,
    `${ENDPOINT}/#frag`,
    `${ENDPOINT}:8443`,
    `${ENDPOINT}:443`,
    `https://user:${KEY_A}@synthres.cognitiveservices.azure.com`,
    "https://cognitiveservices.azure.com",
    "https://a.b.cognitiveservices.azure.com",
    "https://synthres.cognitiveservices.azure.com.evil.example",
    "https://synthres.cognitiveservices.azure.com.",
    "https://evil-cognitiveservices.azure.com",
    "https://synthres.openai.azure.com",
    "https://127.0.0.1",
    "https://-bad.cognitiveservices.azure.com",
    ` ${ENDPOINT}`,
    "",
    `https://${"a".repeat(300)}.cognitiveservices.azure.com`,
    7,
    null,
  ])("refuses %j", (value) => {
    expect(azureDocumentIntelligenceOrigin(value)).toBeNull();
    expect(() => azureDocumentIntelligenceOcrSpec({ endpoint: value })).toThrow(TypeError);
  });

  it("reads the selected connection's endpoint: baseUrl first, then providerSpecificData.baseUrl (source resolveOcrCredentials)", () => {
    expect(azureDocumentIntelligenceEndpoint(CRED_A)).toBe(ENDPOINT);
    expect(azureDocumentIntelligenceEndpoint({ baseUrl: ` ${OTHER_ENDPOINT}/ `, providerSpecificData: { baseUrl: ENDPOINT } })).toBe(OTHER_ENDPOINT);
    expect(azureDocumentIntelligenceEndpoint({ baseUrl: "", providerSpecificData: { baseUrl: ENDPOINT } })).toBe(ENDPOINT);
    expect(azureDocumentIntelligenceEndpoint({ baseUrl: "https://example.com", providerSpecificData: { baseUrl: ENDPOINT } })).toBeNull();
    expect(azureDocumentIntelligenceEndpoint({ apiKey: KEY_A })).toBeNull();
    expect(azureDocumentIntelligenceEndpoint({ providerSpecificData: { baseUrl: 5 } })).toBeNull();
    expect(azureDocumentIntelligenceEndpoint(null)).toBeNull();
  });

  it("builds a foundation adapter bound to the configured origin with the source registry model", () => {
    const adapter = defineOcrAdapter(azureDocumentIntelligenceOcrSpec({ endpoint: `${ENDPOINT}/` }));
    expect(adapter).toMatchObject({
      id: PROVIDER,
      label: "Azure Document Intelligence",
      origins: [ENDPOINT],
      models: [{ id: "prebuilt-read", name: "Azure Document Intelligence (Read)" }],
      inlineMediaTypes: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
      acceptsUrl: true,
      acceptsModel: null,
      poll: { maxAttempts: 30, intervalMs: 1000 },
    });
    expect(Object.keys(adapter.options)).toEqual([]);
    expect(azureDocumentIntelligenceOcrSpec({ endpoint: ENDPOINT }).origins).toEqual([ENDPOINT]);
    expect(() => azureDocumentIntelligenceOcrSpec()).toThrow(TypeError);
  });
});

describe("Azure analyze protocol (source AZURE_DI_TRANSFORMATION)", () => {
  it("submits a document URL as urlSource with the subscription key, polls Operation-Location and returns one aggregated page", async () => {
    const { dispatch, calls, sleeps } = dispatcher([accepted(), running("notStarted"), running(), json(SUCCEEDED)]);
    const result = await dispatch(urlBody({ model: "azure-document-intelligence/prebuilt-read" }));
    expect(result).toMatchObject({ success: true, status: 200, provider: PROVIDER, model: "prebuilt-read", document: { type: "document_url", source: "url", url: DOC_URL } });
    expect(result.body).toEqual({ model: "prebuilt-read", pages: [{ index: 0, markdown: SUCCEEDED.analyzeResult.content }], usage_info: { pages_processed: 3 } });
    expect(await result.response.json()).toEqual(result.body);
    expect(result.accounting).toMatchObject({ modality: "ocr", nativeUnits: { pages: 3 }, meta: { nativeUnitsSource: "usage_info.pages_processed" } });

    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe(ANALYZE_URL);
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(calls[0].init.headers).toEqual({ "Ocp-Apim-Subscription-Key": KEY_A, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({ urlSource: DOC_URL });
    for (const poll of calls.slice(1)) {
      expect(poll.url).toBe(OP_URL);
      expect(poll.init).toMatchObject({ method: "GET", redirect: "manual" });
      expect(poll.init.headers).toEqual({ "Ocp-Apim-Subscription-Key": KEY_A });
      expect(poll.init.body).toBeUndefined();
    }
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it("accepts the bare listed model id", async () => {
    const { dispatch, calls } = dispatcher([accepted(), json(SUCCEEDED)]);
    expect((await dispatch(urlBody())).success).toBe(true);
    expect(calls[0].url).toBe(ANALYZE_URL);
  });

  it.each([
    ["PDF", "application/pdf", PDF_B64, "document_url"],
    ["PNG image_url", "image/png", PNG_B64, "image_url"],
    ["JPEG", "image/jpeg", PNG_B64, "image_url"],
    ["TIFF", "image/tiff", TIFF_B64, "document_url"],
  ])("sends an inline %s as base64Source without the data URL header", async (_name, mediaType, b64, field) => {
    const { dispatch, calls } = dispatcher([accepted(), json(SUCCEEDED)]);
    const result = await dispatch(inlineBody(mediaType, b64, field));
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ base64Source: b64 });
    expect(result.document).toEqual({ type: field, source: "inline", mediaType, bytes: Buffer.from(b64, "base64").length });
    expect(JSON.stringify(result.body)).not.toContain(b64);
  });

  it("takes image_url as { url } and drops the URL fragment", async () => {
    const { dispatch, calls } = dispatcher([accepted(), json(SUCCEEDED)]);
    await dispatch({ model: "prebuilt-read", document: { type: "image_url", image_url: { url: "https://files.example.org/scan.png#p2" } } });
    expect(calls[0].body).toEqual({ urlSource: "https://files.example.org/scan.png" });
  });

  it("builds the analyze URL with the source api-version and markdown output", () => {
    const url = new URL(azureDocumentIntelligenceAnalyzeUrl(ENDPOINT, "prebuilt-read"));
    expect(url.origin).toBe(ENDPOINT);
    expect(url.pathname).toBe("/documentintelligence/documentModels/prebuilt-read:analyze");
    expect(Object.fromEntries(url.searchParams)).toEqual({ "api-version": "2024-11-30", outputContentFormat: "markdown" });
    expect(azureDocumentIntelligenceAnalyzeUrl(ENDPOINT, "a/b")).toContain("documentModels/a%2Fb:analyze");
  });

  it("maps normalized documents to the source body fields only", () => {
    expect(azureDocumentIntelligenceSource({ source: "url", url: DOC_URL })).toEqual({ urlSource: DOC_URL });
    expect(azureDocumentIntelligenceSource({ source: "inline", base64: PDF_B64, dataUrl: "data:..." })).toEqual({ base64Source: PDF_B64 });
    expect(() => azureDocumentIntelligenceSource({ source: "inline", base64: "" })).toThrow(TypeError);
    expect(() => azureDocumentIntelligenceSource({ document_url: DOC_URL })).toThrow(TypeError);
  });

  it("reports the requested model, falls back to returned pages when Azure omits pages", async () => {
    const { dispatch } = dispatcher([accepted(), json({ status: "succeeded", analyzeResult: { modelId: "something-else", content: "" } })]);
    const result = await dispatch(urlBody());
    expect(result.body).toEqual({ model: "prebuilt-read", pages: [{ index: 0, markdown: "" }] });
    expect(result.accounting).toMatchObject({ nativeUnits: { pages: 1 }, meta: { nativeUnitsSource: "returned-pages" } });
  });

  it("parses only a succeeded analyzeResult with string content", () => {
    expect(parseAzureDocumentIntelligenceResult(SUCCEEDED, { model: "prebuilt-read" })).toEqual({
      model: "prebuilt-read", pages: [{ index: 0, markdown: SUCCEEDED.analyzeResult.content }], usage_info: { pages_processed: 3 },
    });
    for (const raw of [null, {}, { status: "running", analyzeResult: SUCCEEDED.analyzeResult }, { status: "succeeded" }, { status: "succeeded", analyzeResult: { content: 5 } }]) {
      expect(() => parseAzureDocumentIntelligenceResult(raw, { model: "prebuilt-read" })).toThrow(TypeError);
    }
  });

  it("maps Azure analyze states to poll states and refuses undocumented ones", () => {
    expect(azureDocumentIntelligencePollState({ status: "notStarted" })).toBe("running");
    expect(azureDocumentIntelligencePollState({ status: "running" })).toBe("running");
    expect(azureDocumentIntelligencePollState({ status: "succeeded" })).toBe("succeeded");
    expect(azureDocumentIntelligencePollState({ status: "failed" })).toBe("failed");
    expect(azureDocumentIntelligencePollState({ status: "canceled" })).toBe("failed");
    for (const value of [{ status: "Succeeded" }, {}, null, "succeeded"]) expect(() => azureDocumentIntelligencePollState(value)).toThrow(TypeError);
  });
});

describe("Azure request validation (nothing is sent)", () => {
  const refused = async (body, pattern, status = 400) => {
    const { dispatch, calls } = dispatcher([]);
    const result = await dispatch(body);
    expect(result).toMatchObject({ success: false, status, local: true });
    if (pattern) expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
    return result;
  };

  it("requires a model and supports only prebuilt-read", async () => {
    await refused({ document: { document_url: DOC_URL } }, /need a model/);
    await refused(urlBody({ model: "prebuilt-layout" }), /Unsupported OCR model.*prebuilt-read/);
    await refused(urlBody({ model: "azure-document-intelligence/custom-model-1" }), /Unsupported/);
    await refused(urlBody({ model: "mistral/mistral-ocr-latest" }), /Unsupported/);
    await refused(urlBody({ model: "vertex-deepseek-ocr/deepseek-ocr-maas" }), /Unsupported/);
    await refused(urlBody({ model: "azure-document-intelligence/../prebuilt-read" }), /plain model id/);
  });

  it("refuses fields the source never sends to Azure", async () => {
    await refused(urlBody({ pages: [0] }), /does not support pages/);
    await refused(urlBody({ include_image_base64: true }), /does not support/);
    await refused(urlBody({ outputContentFormat: "text" }), /does not support/);
  });

  it.each([
    ["http URL", { document_url: "http://files.example.org/a.pdf" }],
    ["loopback", { document_url: "https://127.0.0.1/a.pdf" }],
    ["metadata service", { document_url: "https://169.254.169.254/latest" }],
    ["private network", { document_url: "https://10.0.0.5/a.pdf" }],
    ["localhost", { document_url: "https://localhost/a.pdf" }],
    ["userinfo", { document_url: `https://u:${KEY_A}@files.example.org/a.pdf` }],
    ["two documents", { document_url: DOC_URL, image_url: DOC_URL }],
    ["unknown document field", { document_url: DOC_URL, document_name: "x" }],
    ["WebP inline (Azure Read does not take it)", { image_url: `data:image/webp;base64,${PNG_B64}` }],
    ["GIF inline (Azure Read does not take it)", { image_url: `data:image/gif;base64,${PNG_B64}` }],
    ["HTML inline", { document_url: `data:text/html;base64,${PNG_B64}` }],
    ["non-base64 data URL", { document_url: "data:application/pdf,%PDF" }],
    ["PDF as image_url", { image_url: `data:application/pdf;base64,${PDF_B64}` }],
    ["empty inline", { document_url: "data:application/pdf;base64," }],
  ])("refuses %s", async (_name, document) => {
    const result = await refused({ model: "prebuilt-read", document });
    await expectNoLeak(result);
  });

  it("refuses an over-long document URL", async () => {
    await refused({ model: "prebuilt-read", document: { document_url: `https://files.example.org/${"a".repeat(8200)}` } }, /at most 8192/);
  });

  it("validates through the foundation with the Azure adapter's own narrowing", () => {
    const adapter = defineOcrAdapter(azureDocumentIntelligenceOcrSpec({ endpoint: ENDPOINT }));
    expect(validateOcrRequest(adapter, inlineBody("image/tiff", TIFF_B64)).document).toMatchObject({ source: "inline", mediaType: "image/tiff" });
    expect(() => validateOcrRequest(adapter, inlineBody("image/webp", PNG_B64, "image_url"))).toThrow(/does not accept image\/webp/);
  });
});

describe("Azure credentials (selected connection only)", () => {
  it.each([
    ["no apiKey", { providerSpecificData: { baseUrl: ENDPOINT } }],
    ["blank apiKey", { apiKey: "   ", providerSpecificData: { baseUrl: ENDPOINT } }],
    ["non-string apiKey", { apiKey: 42, providerSpecificData: { baseUrl: ENDPOINT } }],
    ["accessToken only (not a subscription key)", { accessToken: KEY_A, providerSpecificData: { baseUrl: ENDPOINT } }],
    ["header injection", { apiKey: `${KEY_A}\r\nX-Evil: 1`, providerSpecificData: { baseUrl: ENDPOINT } }],
    ["no endpoint on the connection", { apiKey: KEY_A }],
    ["another resource's connection", { apiKey: KEY_A, providerSpecificData: { baseUrl: OTHER_ENDPOINT } }],
    ["a non-Azure endpoint", { apiKey: KEY_A, baseUrl: "https://example.com" }],
    ["no credentials", null],
  ])("refuses %s with 401 before sending", async (_name, credentials) => {
    const { dispatch, calls } = dispatcher([]);
    const result = await dispatch(urlBody(), credentials);
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
    await expectNoLeak(result);
  });

  it("sends the selected connection's key on the submit and every poll", async () => {
    const { dispatch, calls } = dispatcher([accepted(), running(), json(SUCCEEDED)]);
    expect((await dispatch(urlBody(), CRED_B)).success).toBe(true);
    expect(calls.map((call) => call.init.headers["Ocp-Apim-Subscription-Key"])).toEqual([KEY_B, KEY_B, KEY_B]);
    expect(JSON.stringify(calls)).not.toContain(KEY_A);
  });

  it("trims the configured key and ignores the source accessToken precedence", async () => {
    const { dispatch, calls } = dispatcher([accepted(), json(SUCCEEDED)]);
    await dispatch(urlBody(), { apiKey: ` ${KEY_B} `, accessToken: KEY_A, providerSpecificData: { baseUrl: ENDPOINT } });
    expect(calls[0].init.headers["Ocp-Apim-Subscription-Key"]).toBe(KEY_B);
    expect(JSON.stringify(calls)).not.toContain(KEY_A);
  });

  it("routes only to the endpoint the adapter was built for, never to a request-supplied base URL", async () => {
    const { dispatch, calls } = dispatcher([accepted(`${OTHER_ENDPOINT}/documentintelligence/documentModels/prebuilt-read/analyzeResults/x`), json(SUCCEEDED)], { endpoint: OTHER_ENDPOINT });
    const result = await dispatch(urlBody(), { apiKey: KEY_A, baseUrl: OTHER_ENDPOINT });
    expect(result.success).toBe(true);
    expect(calls.every((call) => call.url.startsWith(`${OTHER_ENDPOINT}/`))).toBe(true);
  });
});

describe("Azure refusals and quota (submit sent once, never replayed)", () => {
  it.each([
    [400, 400, false],
    [401, 401, false],
    [403, 403, false],
    [404, 404, false],
    [413, 413, false],
    [415, 415, false],
    [500, 502, true],
    [502, 502, true],
  ])("maps %i to %i without quoting the upstream", async (upstream, status, acceptedJob) => {
    const { dispatch, calls } = dispatcher([leaky(upstream)]);
    const result = await dispatch(urlBody());
    expect(result).toMatchObject({ success: false, status });
    expect(result.local).toBeUndefined();
    expect(Boolean(result.acceptedJob)).toBe(acceptedJob);
    if (acceptedJob) expect(result.acceptedJob).toMatchObject({ modality: "ocr", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("flags quota (402), keeps Retry-After for 429 and treats 503 as maybe processed", async () => {
    const { dispatch, calls } = dispatcher([leaky(402), leaky(429, { "retry-after": "30" }), leaky(503, { "retry-after": "60" })]);
    const quota = await dispatch(urlBody());
    expect(quota).toMatchObject({ status: 402, quotaExhausted: true });
    expect(quota.acceptedJob).toBeUndefined();
    const limited = await dispatch(urlBody());
    expect(limited).toMatchObject({ status: 429 });
    expect(limited.response.headers.get("retry-after")).toBeTruthy();
    const unavailable = await dispatch(urlBody());
    expect(unavailable).toMatchObject({ status: 503, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(3);
    for (const result of [quota, limited, unavailable]) await expectNoLeak(result);
  });

  it("refuses a submit redirect without following it", async () => {
    const { dispatch, calls } = dispatcher([new Response(null, { status: 307, headers: { location: "https://evil.example/collect" } })]);
    const result = await dispatch(urlBody());
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("treats a transport error after connecting as maybe processed and a pre-connect error as unsent", async () => {
    const sent = dispatcher([() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); }]);
    expect(await sent.dispatch(urlBody())).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    const unsent = dispatcher([() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }]);
    const result = await unsent.dispatch(urlBody());
    expect(result).toMatchObject({ status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });
});

describe("Azure Operation-Location polling", () => {
  const lost = async (answers, status = 502, options = {}) => {
    const { dispatch, calls } = dispatcher(answers, options);
    const result = await dispatch(urlBody());
    expect(result).toMatchObject({ success: false, status, acceptedJob: { costSource: "accepted-job", meta: { jobState: "accepted" } } });
    await expectNoLeak(result);
    return { result, calls };
  };

  it("fails on an analysis that failed or was canceled", async () => {
    const failed = await lost([accepted(), running(), json({ status: "failed", error: { message: KEY_A } })]);
    expect(failed.result.error).toMatch(/analysis failed/);
    expect(failed.calls).toHaveLength(3);
    await lost([accepted(), json({ status: "canceled" })]);
  });

  it("gives up after 30 status checks with a 504 (source pollOcrOperation)", async () => {
    const answers = [accepted(), ...Array.from({ length: 30 }, () => running())];
    const { result, calls } = await lost(answers, 504);
    expect(result.error).toMatch(/30 status checks/);
    expect(calls).toHaveLength(31);
  });

  it.each([
    ["missing Operation-Location", () => accepted(null)],
    ["cross-origin Operation-Location", () => accepted("https://evil.example/documentintelligence/documentModels/prebuilt-read/analyzeResults/1")],
    ["another Azure resource", () => accepted(`${OTHER_ENDPOINT}/documentintelligence/documentModels/prebuilt-read/analyzeResults/1`)],
    ["http Operation-Location", () => accepted("http://synthres.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-read/analyzeResults/1")],
    ["unexpected path", () => accepted(`${ENDPOINT}/admin/keys`)],
    ["path traversal", () => accepted(`${ENDPOINT}/documentintelligence/documentModels/prebuilt-read/analyzeResults/../../keys`)],
    ["unparseable Operation-Location", () => accepted("::not a url")],
    ["a 200 answer instead of 202", () => json(SUCCEEDED)],
  ])("never polls on %s and reports the accepted job as lost", async (_name, answer) => {
    const { calls } = await lost([answer()]);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["a refused status check", () => leaky(500)],
    ["a rate-limited status check", () => leaky(429, { "retry-after": "5" })],
    ["a redirected status check", () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
    ["an unreadable status answer", () => new Response("not json", { status: 200 })],
    ["an undocumented status", () => json({ status: "paused" })],
    ["a succeeded answer without content", () => json({ status: "succeeded", analyzeResult: { pages: [] } })],
  ])("reports %s as a lost accepted job without replaying the submit", async (_name, answer) => {
    const { calls } = await lost([accepted(), answer()]);
    expect(calls).toHaveLength(2);
    expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
  });
});

describe("Azure abort and deadline", () => {
  it("refuses locally when the caller aborted before the send", async () => {
    const { dispatch, calls } = dispatcher([]);
    const controller = new AbortController();
    controller.abort();
    const result = await dispatch(urlBody(), CRED_A, { signal: controller.signal });
    expect(result).toMatchObject({ status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("marks a submit that hit the deadline as submit-unknown", async () => {
    const { dispatch, calls } = dispatcher([hang], { timeoutMs: 20 });
    expect(await dispatch(urlBody())).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("marks a caller abort during the submit as submit-unknown", async () => {
    const controller = new AbortController();
    const { dispatch } = dispatcher([() => { setTimeout(() => controller.abort(), 5); return hang(); }]);
    expect(await dispatch(urlBody(), CRED_A, { signal: controller.signal })).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("marks a deadline during a status check as accepted (one deadline covers submit and polls)", async () => {
    const { dispatch, calls } = dispatcher([accepted(), running(), hang], { timeoutMs: 30 });
    expect(await dispatch(urlBody())).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(calls).toHaveLength(3);
  });

  it("marks a caller abort during the poll sleep as accepted", async () => {
    const controller = new AbortController();
    const { dispatch, calls } = dispatcher([accepted()], { sleepImpl: () => { setTimeout(() => controller.abort(), 5); return hang(); } });
    expect(await dispatch(urlBody(), CRED_A, { signal: controller.signal })).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(calls).toHaveLength(1);
  });
});

// Staging block: everything below asserts the unregistered state and is the
// only part registration may promote to strict positive identity assertions.
describe("staging: azure-document-intelligence OCR is not registered", () => {
  it("declares a staged, unregistered adapter sourced from OmniRoute c71f0065", () => {
    expect(REGISTRATION).toMatchObject({ issue: "#2034", status: "staged-unregistered", kind: "ocr-provider-adapter", provider: PROVIDER, module: `${MODULE_DIR}/index.js` });
    expect(REGISTRATION.source).toMatchObject({
      repository: "OmniRoute",
      commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad",
      files: ["open-sse/config/ocrRegistry.ts", "open-sse/handlers/ocr.ts"],
      registryEntry: { id: PROVIDER, authHeader: "Ocp-Apim-Subscription-Key", models: [{ id: "prebuilt-read" }] },
    });
  });

  it("documents every export of the module", () => {
    expect(Object.keys(REGISTRATION.exports).sort()).toEqual(Object.keys(azure).sort());
  });

  it("is imported by nothing in production", () => {
    let listed = "";
    try {
      listed = execFileSync("git", ["grep", "-l", "native-ocr-azure-document-intelligence", "--", "open-sse", "src", "cli"], { cwd: ROOT, encoding: "utf8" });
    } catch (error) {
      if (error.status !== 1) throw error; // 1: no match
    }
    const hits = listed.trim().split("\n").filter(Boolean);
    expect(hits.every((file) => file.startsWith(`${MODULE_DIR}/`))).toBe(true);
  });

  it("does not import dispatch code, so the OCR foundation stays unimported in production", () => {
    const sources = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", MODULE_DIR], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter((file) => file.endsWith(".js"));
    expect(sources.some((file) => file.endsWith("adapter.js"))).toBe(true);
    for (const file of sources) {
      const text = readFileSync(new URL(file, ROOT), "utf8");
      expect(text).not.toMatch(/native-ocr-foundation|createOcrDispatcher|proxyFetch|\bimport\b[^;]*providerParity/);
      expect(text).not.toMatch(/api\.mistral\.ai|aiplatform\.googleapis|deepseek-ocr-maas/);
    }
  });
});
