// Mistral native OCR adapter, staged and unregistered (#2034). Closed mocks
// only: every request goes to an injected transport that fails the test on
// anything unexpected, and every key is synthetic. Wire shapes follow the
// vendor OpenAPI operation ocr_v1_ocr_post (OCRRequest / OCRResponse) and the
// source MISTRAL_PASSTHROUGH in OmniRoute c71f0065
// open-sse/config/ocrRegistry.ts and open-sse/handlers/ocr.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as mistralOcr from "../../open-sse/services/providerParity/native-ocr-mistral/index.js";
import {
  MISTRAL_OCR_MODELS,
  MISTRAL_OCR_OPTION_FIELDS,
  MISTRAL_OCR_RETIRED_MODELS,
  MISTRAL_OCR_URL,
  buildMistralOcrRequest,
  createMistralOcrDispatcher,
  mistralOcrAdapter,
  mistralOcrAuthHeaders,
  parseMistralOcrResponse,
  validateMistralOcrPages,
} from "../../open-sse/services/providerParity/native-ocr-mistral/index.js";
import { createOcrDispatcher, defineOcrAdapter } from "../../open-sse/services/providerParity/native-ocr-foundation/index.js";

const ROOT = new URL("../../", import.meta.url);
const MODULE_DIR = "open-sse/services/providerParity/native-ocr-mistral";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${MODULE_DIR}/registration.json`, ROOT), "utf8"));

const KEY_A = "SYNTHETIC-mistral-ocr-key-a-0001";
const KEY_B = "SYNTHETIC-mistral-ocr-key-b-0002";
const TOKEN = "SYNTHETIC-mistral-ocr-token-0003";
const DOC_URL = "https://files.example.org/report.pdf";
const IMG_URL = "https://files.example.org/scan.png";
const PDF_B64 = Buffer.from("%PDF-1.7 synthetic").toString("base64");
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) =>
  json({ object: "error", message: `upstream echo ${KEY_A} at /srv/mistral/ocr.py:12`, type: "invalid_request_error" }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const hang = () => new Promise(() => {});

/** Vendor OCRResponse example shape (synthetic text), including fields the gateway drops. */
const OCR_RESPONSE = {
  pages: [
    {
      index: 1,
      markdown: "## Results\n\n![img-0.jpeg](img-0.jpeg)",
      images: [{ id: "img-0.jpeg", top_left_x: 1, top_left_y: 2, bottom_right_x: 3, bottom_right_y: 4, image_base64: "data:image/jpeg;base64,AAAA" }],
      tables: [],
      hyperlinks: ["https://example.org"],
      header: null,
      footer: null,
      dimensions: { dpi: 200, height: 2200, width: 1700 },
      blocks: [{ type: "text", content: "Results", top_left_x: 0, top_left_y: 0, bottom_right_x: 1, bottom_right_y: 1 }],
    },
    { index: 0, markdown: "# Title", images: [], dimensions: { dpi: 200, height: 2200, width: 1700 } },
  ],
  model: "mistral-ocr-2512",
  document_annotation: "{\"secret\":\"dropped\"}",
  usage_info: { pages_processed: 2, doc_size_bytes: null },
};

/** Closed transport: answers in order, records each call, rejects anything beyond the script. */
function transport(...answers) {
  const calls = [];
  const fetchImpl = async (url, init, proxyOptions) => {
    calls.push({ url: String(url), init, proxyOptions, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

const sleeps = [];
const recordSleep = async (ms) => void sleeps.push(ms);

function dispatcher(answers, options = {}) {
  const t = transport(...answers);
  const d = createMistralOcrDispatcher({ fetchImpl: t.fetchImpl, sleepImpl: recordSleep, ...options });
  return { ...t, dispatch: d.dispatch, d };
}

const CRED = { apiKey: KEY_A, connectionId: "conn-a" };
const body = (extra = {}) => ({ model: "mistral-ocr-latest", document: { type: "document_url", document_url: DOC_URL }, ...extra });
const run = (answers, args = {}, options = {}) => {
  const d = dispatcher(answers, options);
  return d.dispatch({ provider: "mistral", body: body(), credentials: CRED, ...args }).then((result) => ({ ...d, result }));
};

async function bodyText(result) {
  return result.response ? await result.response.clone().text() : "";
}

async function expectNoLeak(result) {
  const text = `${result.error ?? ""} ${await bodyText(result)}`;
  for (const secret of [KEY_A, KEY_B, TOKEN, "/srv/mistral", "upstream echo"]) expect(text).not.toContain(secret);
}

describe("Mistral OCR adapter definition", () => {
  it("is a frozen foundation adapter bound to the vendor origin only", () => {
    expect(Object.isFrozen(mistralOcrAdapter)).toBe(true);
    expect(mistralOcrAdapter).toMatchObject({
      id: "mistral",
      label: "Mistral",
      origins: ["https://api.mistral.ai"],
      documentTypes: ["document_url", "image_url"],
      acceptsUrl: true,
      acceptsModel: null,
      pollUrl: null,
      pollState: null,
    });
    expect(mistralOcrAdapter.inlineMediaTypes).toEqual(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/tiff"]);
    expect(Object.keys(mistralOcrAdapter.options)).toEqual(["pages", "image_limit", "image_min_size"]);
    expect(MISTRAL_OCR_OPTION_FIELDS).toEqual(["pages", "image_limit", "image_min_size"]);
    expect(MISTRAL_OCR_URL).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("lists the source models first, then the current vendor OCR 4.1 ids", () => {
    expect(MISTRAL_OCR_MODELS.map((row) => row.id)).toEqual(["mistral-ocr-latest", "mistral-ocr-2512", "mistral-ocr-4-1", "mistral-ocr-4"]);
    expect(MISTRAL_OCR_MODELS.every((row) => row.kind === "ocr" && Object.isFrozen(row))).toBe(true);
    expect(mistralOcrAdapter.models).toEqual(MISTRAL_OCR_MODELS.map(({ id, name }) => ({ id, name })));
    expect(mistralOcr.mistralOcrModel("mistral-ocr-2512")).toMatchObject({ name: "Mistral OCR 3" });
    expect(mistralOcr.mistralOcrModel("mistral-ocr-4-0")).toBeNull();
    for (const retired of MISTRAL_OCR_RETIRED_MODELS) expect(mistralOcr.mistralOcrModel(retired)).toBeNull();
  });

  it("plugs into a shared foundation dispatcher next to another adapter", () => {
    const other = defineOcrAdapter({
      id: "other-ocr",
      origins: ["https://ocr.example.com"],
      models: [{ id: "x", name: "X" }],
      authHeaders: () => ({ "x-key": "k" }),
      buildRequest: () => ({ url: "https://ocr.example.com/v1" }),
      parseResponse: (raw) => raw,
    });
    const shared = createOcrDispatcher({ adapters: [mistralOcrAdapter, other], fetchImpl: async () => { throw new Error("unexpected"); } });
    expect(shared.providers()).toEqual(["mistral", "other-ocr"]);
    expect(shared.adapter("mistral")).toBe(mistralOcrAdapter);
  });
});

describe("Mistral OCR wire (vendor OCRRequest)", () => {
  it("sends one bounded Bearer POST to /v1/ocr and normalizes the OCRResponse", async () => {
    const { calls, result } = await run([json(OCR_RESPONSE)], { body: body({ pages: [0, 1], image_limit: 3, image_min_size: 0 }) });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.mistral.ai/v1/ocr");
    expect(call.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(call.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(call.body).toEqual({
      model: "mistral-ocr-latest",
      document: { type: "document_url", document_url: DOC_URL },
      pages: [0, 1],
      image_limit: 3,
      image_min_size: 0,
    });
    expect(Object.keys(call.body)).toEqual(["model", "document", "pages", "image_limit", "image_min_size"]);
    expect(result).toMatchObject({ success: true, status: 200, provider: "mistral", model: "mistral-ocr-latest", document: { type: "document_url", source: "url", url: DOC_URL } });
    expect(result.body).toEqual({
      model: "mistral-ocr-2512",
      pages: [{ index: 0, markdown: "# Title" }, { index: 1, markdown: "## Results\n\n![img-0.jpeg](img-0.jpeg)" }],
      usage_info: { pages_processed: 2 },
    });
    expect(await bodyText(result)).not.toMatch(/image_base64|document_annotation|dropped|blocks/);
    expect(await result.response.json()).toEqual(result.body);
    expect(sleeps).toHaveLength(0);
  });

  it.each([
    ["document_url URL", { type: "document_url", document_url: DOC_URL }, { type: "document_url", document_url: DOC_URL }],
    ["image_url URL string", { type: "image_url", image_url: IMG_URL }, { type: "image_url", image_url: IMG_URL }],
    ["image_url { url } object", { image_url: { url: IMG_URL } }, { type: "image_url", image_url: IMG_URL }],
    ["inline PDF document_url", { document_url: `data:application/pdf;base64,${PDF_B64}` }, { type: "document_url", document_url: `data:application/pdf;base64,${PDF_B64}` }],
    ["inline PNG image_url", { type: "image_url", image_url: `data:image/png;base64,${PNG_B64}` }, { type: "image_url", image_url: `data:image/png;base64,${PNG_B64}` }],
  ])("builds the vendor document chunk for %s", async (_name, document, wire) => {
    const { calls, result } = await run([json({ pages: [{ index: 0, markdown: "x" }], model: "mistral-ocr-latest", usage_info: { pages_processed: 1 } })], { body: body({ document }) });
    expect(calls[0].body.document).toEqual(wire);
    expect(result.success).toBe(true);
    if (result.document.source === "inline") expect(JSON.stringify(result.document)).not.toContain(PDF_B64.slice(0, 12));
  });

  it("drops a URL fragment before sending", async () => {
    const { calls } = await run([json({ pages: [], model: "mistral-ocr-latest" })], { body: body({ document: { document_url: `${DOC_URL}#page=2` } }) });
    expect(calls[0].body.document.document_url).toBe(DOC_URL);
  });

  it("builds the request directly with only declared fields", () => {
    const built = buildMistralOcrRequest({
      model: "mistral-ocr-2512",
      document: { type: "image_url", source: "inline", mediaType: "image/png", bytes: 7, base64: PNG_B64, dataUrl: `data:image/png;base64,${PNG_B64}` },
      options: { pages: "0-2", include_image_base64: true },
    });
    expect(built).toEqual({ url: MISTRAL_OCR_URL, method: "POST", body: { model: "mistral-ocr-2512", document: { type: "image_url", image_url: `data:image/png;base64,${PNG_B64}` }, pages: "0-2" } });
  });

  it("does not poll even when the answer carries an Operation-Location", async () => {
    const { calls, result } = await run([json({ pages: [{ index: 0, markdown: "sync" }], model: "mistral-ocr-latest" }, 200, { "operation-location": "https://api.mistral.ai/v1/ocr/ops/1" })]);
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("passes the selected connection's proxy options to the transport", async () => {
    const { calls } = await run([json({ pages: [], model: "mistral-ocr-latest" })], {
      credentials: { ...CRED, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.com:8080" } },
    });
    expect(calls[0].proxyOptions).not.toBeUndefined();
  });
});

describe("Mistral OCR models", () => {
  it.each(MISTRAL_OCR_MODELS.map((row) => row.id))("accepts %s bare and with the mistral/ prefix", async (id) => {
    for (const model of [id, `mistral/${id}`]) {
      const { calls, result } = await run([json({ pages: [], model: id })], { body: body({ model }) });
      expect(result.success).toBe(true);
      expect(calls[0].body.model).toBe(id);
    }
  });

  it.each([
    ...MISTRAL_OCR_RETIRED_MODELS,
    "mistral-ocr-9",
    "mistral-large-latest",
    "deepseek-ocr-maas",
    "prebuilt-read",
    "azure-document-intelligence/prebuilt-read",
    "mistral/../ocr",
  ])("refuses %s locally without sending", async (model) => {
    const { calls, result } = await run([], { body: body({ model }) });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(calls).toHaveLength(0);
  });

  it("requires a model (no source default of mistral-ocr-latest)", async () => {
    const { calls, result } = await run([], { body: { document: { document_url: DOC_URL } } });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(result.error).toMatch(/need a model/);
    expect(calls).toHaveLength(0);
  });
});

describe("Mistral OCR auth and credential selection", () => {
  it("prefers the API key over an access token", () => {
    expect(mistralOcrAuthHeaders({ apiKey: KEY_A, accessToken: TOKEN })).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(mistralOcrAuthHeaders({ accessToken: TOKEN })).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(mistralOcrAuthHeaders({ apiKey: "  ", accessToken: TOKEN })).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it.each([
    ["no credentials", undefined],
    ["empty", {}],
    ["blank key", { apiKey: "   " }],
    ["key with a line break", { apiKey: `${KEY_A}\r\nX-Evil: 1` }],
    ["key with a space", { apiKey: "two words" }],
    ["non-string key", { apiKey: 1234 }],
    ["provider data only", { providerSpecificData: { apiKey: KEY_A } }],
  ])("refuses %s with 401 before sending", async (_name, credentials) => {
    const { calls, result } = await run([], { credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(calls).toHaveLength(0);
    await expectNoLeak(result);
  });

  it("uses each selected connection's own key and never a connection base URL", async () => {
    const { dispatch, calls } = dispatcher([json({ pages: [], model: "m" }), json({ pages: [], model: "m" })]);
    await dispatch({ provider: "mistral", body: body(), credentials: { apiKey: KEY_A, baseUrl: "https://evil.example.net/v1/ocr" } });
    await dispatch({ provider: "mistral", body: body(), credentials: { apiKey: KEY_B, providerSpecificData: { baseUrl: "https://evil.example.net" } } });
    expect(calls.map((c) => c.url)).toEqual([MISTRAL_OCR_URL, MISTRAL_OCR_URL]);
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("refuses another provider id on the Mistral dispatcher", async () => {
    const { dispatch, calls } = dispatcher([]);
    const result = await dispatch({ provider: "azure-document-intelligence", body: body(), credentials: CRED });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(result.error).toContain("Available: mistral");
    expect(calls).toHaveLength(0);
  });
});

describe("Mistral OCR input safety (nothing is sent)", () => {
  it.each([
    ["http URL", { document_url: "http://files.example.org/a.pdf" }],
    ["loopback URL", { document_url: "https://127.0.0.1/a.pdf" }],
    ["metadata URL", { document_url: "https://169.254.169.254/latest" }],
    ["private URL", { image_url: "https://10.0.0.5/a.png" }],
    ["localhost URL", { document_url: "https://localhost/a.pdf" }],
    ["userinfo URL", { document_url: `https://user:${KEY_A}@files.example.org/a.pdf` }],
    ["text data URL", { document_url: `data:text/plain;base64,${PDF_B64}` }],
    ["docx data URL", { document_url: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${PDF_B64}` }],
    ["PDF as image_url", { image_url: `data:application/pdf;base64,${PDF_B64}` }],
    ["non-base64 data URL", { document_url: "data:application/pdf,%PDF" }],
    ["empty data URL", { document_url: "data:application/pdf;base64," }],
    ["both fields", { document_url: DOC_URL, image_url: IMG_URL }],
    ["mismatched type", { type: "image_url", document_url: DOC_URL }],
    ["FileChunk", { type: "file", file_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }],
    ["document_name", { document_url: DOC_URL, document_name: "report.pdf" }],
    ["image detail", { image_url: { url: IMG_URL, detail: "high" } }],
    ["missing document", undefined],
  ])("refuses a %s", async (_name, document) => {
    const { calls, result } = await run([], { body: body({ document }) });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(calls).toHaveLength(0);
    await expectNoLeak(result);
  });

  it.each([
    ["include_image_base64", true],
    ["include_blocks", true],
    ["confidence_scores_granularity", "word"],
    ["table_format", "html"],
    ["extract_header", true],
    ["extract_footer", true],
    ["bbox_annotation_format", { type: "json_schema" }],
    ["document_annotation_format", { type: "json_schema" }],
    ["document_annotation_prompt", "extract"],
    ["stream", true],
    ["id", "client-id"],
  ])("refuses the vendor/unknown field %s whose output would be dropped", async (field, value) => {
    const { calls, result } = await run([], { body: body({ [field]: value }) });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(result.error).toContain(field);
    expect(calls).toHaveLength(0);
  });

  it("treats null optional fields as absent", async () => {
    const { calls } = await run([json({ pages: [], model: "m" })], { body: body({ pages: null, image_limit: null, table_format: null }) });
    expect(calls[0].body).toEqual({ model: "mistral-ocr-latest", document: { type: "document_url", document_url: DOC_URL } });
  });

  it.each([
    [[0, 2, 5]],
    ["0"],
    ["0,1,2"],
    ["0-5"],
    ["0,2-4"],
    ["3-3"],
  ])("accepts the pages selector %j", (value) => {
    expect(validateMistralOcrPages(value)).toEqual(value);
  });

  it.each([
    [[]],
    [[-1]],
    [[1.5]],
    [["1"]],
    [Array.from({ length: 1001 }, (_, i) => i)],
    [""],
    ["5-2"],
    ["1, 2"],
    ["-1"],
    ["0,,1"],
    ["a-b"],
    ["9".repeat(30)],
    ["1,".repeat(600) + "1"],
    [true],
    [{ from: 0 }],
  ])("refuses the pages selector %j without sending", async (value) => {
    expect(() => validateMistralOcrPages(value)).toThrow();
    const { calls, result } = await run([], { body: body({ pages: value }) });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(result.error).toMatch(/pages/);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["image_limit", -1],
    ["image_limit", 1.5],
    ["image_limit", "3"],
    ["image_min_size", -10],
    ["image_min_size", Number.MAX_VALUE],
  ])("refuses %s=%j without sending", async (field, value) => {
    const { calls, result } = await run([], { body: body({ [field]: value }) });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(result.error).toContain(field);
    expect(calls).toHaveLength(0);
  });
});

describe("Mistral OCR answers and usage", () => {
  it("parses the OCRResponse into the foundation shape", () => {
    expect(parseMistralOcrResponse(OCR_RESPONSE)).toEqual({ pages: OCR_RESPONSE.pages, model: "mistral-ocr-2512", usage_info: OCR_RESPONSE.usage_info });
    expect(parseMistralOcrResponse({ pages: [] })).toEqual({ pages: [] });
    expect(parseMistralOcrResponse({ pages: [], model: 7, usage_info: "x" })).toEqual({ pages: [] });
    for (const raw of [null, [], "x", {}, { pages: {} }]) expect(parseMistralOcrResponse(raw)).toBeNull();
  });

  it("accounts pages from usage_info.pages_processed with unknown cost", async () => {
    const { result } = await run([json(OCR_RESPONSE)]);
    expect(result.accounting).toMatchObject({
      modality: "ocr",
      nativeUnits: { pages: 2 },
      cost: null,
      costStatus: "unknown",
      meta: { nativeUnitsSource: "usage_info.pages_processed", providerUsage: { path: "usage_info", value: { pages_processed: 2 } } },
    });
  });

  it("falls back to returned pages and the requested model when usage and model are missing", async () => {
    const { result } = await run([json({ pages: [{ index: 0, markdown: "a" }, { index: 1, markdown: "b" }, { index: 2, markdown: "c" }] })], { body: body({ model: "mistral/mistral-ocr-4-1" }) });
    expect(result.body).toEqual({ model: "mistral-ocr-4-1", pages: [{ index: 0, markdown: "a" }, { index: 1, markdown: "b" }, { index: 2, markdown: "c" }] });
    expect(result.accounting).toMatchObject({ nativeUnits: { pages: 3 }, meta: { nativeUnitsSource: "returned-pages" } });
  });

  it.each([
    ["no pages", { model: "m", usage_info: { pages_processed: 1 } }],
    ["page without markdown", { pages: [{ index: 0 }], model: "m" }],
    ["negative index", { pages: [{ index: -1, markdown: "x" }], model: "m" }],
    ["duplicate index", { pages: [{ index: 0, markdown: "x" }, { index: 0, markdown: "y" }], model: "m" }],
  ])("treats a malformed answer (%s) as an accepted job and never replays", async (_name, answer) => {
    const { calls, result } = await run([json(answer)]);
    expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { modality: "ocr", costSource: "accepted-job", meta: { jobState: "accepted" } } });
    expect(calls).toHaveLength(1);
  });

  it("treats a non-JSON or oversized 200 as an accepted job", async () => {
    const notJson = await run([new Response("<html>ok</html>", { status: 200 })]);
    expect(notJson.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    const big = await run([json({ pages: [{ index: 0, markdown: "x".repeat(4096) }], model: "m" })], {}, { maxResponseBytes: 1024 });
    expect(big.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(big.result.error).toMatch(/exceeded 1024 bytes/);
  });
});

describe("Mistral OCR errors, quota, abort and deadline", () => {
  it.each([
    [400, 400, false],
    [401, 401, false],
    [403, 403, false],
    [404, 404, false],
    [422, 422, false],
    [500, 502, true],
    [502, 502, true],
    [504, 502, true],
  ])("maps a %i refusal to %i without quoting the upstream", async (upstream, status, accepted) => {
    const { calls, result } = await run([leaky(upstream)]);
    expect(result).toMatchObject({ success: false, status });
    expect(result.local).toBeUndefined();
    expect(Boolean(result.acceptedJob)).toBe(accepted);
    if (accepted) expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("flags 402 as quota and keeps 429/503 Retry-After evidence", async () => {
    const { dispatch, calls } = dispatcher([leaky(402), leaky(429, { "retry-after": "30" }), leaky(503, { "retry-after": "60" })]);
    const quota = await dispatch({ provider: "mistral", body: body(), credentials: CRED });
    expect(quota).toMatchObject({ status: 402, quotaExhausted: true });
    expect(quota.acceptedJob).toBeUndefined();
    const limited = await dispatch({ provider: "mistral", body: body(), credentials: CRED });
    expect(limited.status).toBe(429);
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(limited.acceptedJob).toBeUndefined();
    const unavailable = await dispatch({ provider: "mistral", body: body(), credentials: CRED });
    expect(unavailable).toMatchObject({ status: 503, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(unavailable.resetsAtMs).toBeGreaterThan(Date.now());
    expect(calls).toHaveLength(3);
    for (const result of [quota, limited, unavailable]) await expectNoLeak(result);
  });

  it("refuses a submit redirect without following it", async () => {
    const { calls, result } = await run([new Response(null, { status: 307, headers: { location: "https://evil.example.net/v1/ocr" } })]);
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("separates unsent transport failures from uncertain ones", async () => {
    const unsent = await run([() => Promise.reject(transportError("ECONNREFUSED"))]);
    expect(unsent.result).toMatchObject({ status: 502 });
    expect(unsent.result.acceptedJob).toBeUndefined();
    await expectNoLeak(unsent.result);
    const sent = await run([() => Promise.reject(transportError("ECONNRESET"))]);
    expect(sent.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(sent.calls).toHaveLength(1);
    await expectNoLeak(sent.result);
  });

  it("does not send when the caller already left", async () => {
    const { calls, result } = await run([], { signal: AbortSignal.abort() });
    expect(result).toMatchObject({ status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("marks a caller abort after the send as uncertain", async () => {
    const controller = new AbortController();
    const pending = run([() => { setTimeout(() => controller.abort(), 5); return hang(); }], { signal: controller.signal });
    const { calls, result } = await pending;
    expect(result).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(result.local).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("ends on the deadline with an uncertain accepted job and no replay", async () => {
    const { calls, result } = await run([() => hang()], {}, { timeoutMs: 20 });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("ends on the deadline while reading a delivered answer as accepted", async () => {
    const stalled = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"pages\":")); } }), { status: 200 });
    const { calls, result } = await run([stalled], {}, { timeoutMs: 20 });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(calls).toHaveLength(1);
  });
});

// Staging block: these are the only assertions that depend on the adapter
// being unregistered. Registration promotes them to positive identity checks.
describe("staging: native-ocr-mistral is not registered", () => {
  it("declares a staged, unregistered adapter sourced from OmniRoute c71f0065 and the vendor contract", () => {
    expect(REGISTRATION).toMatchObject({ issue: "#2034", status: "staged-unregistered", kind: "ocr-adapter", module: `${MODULE_DIR}/index.js` });
    expect(REGISTRATION.source).toMatchObject({
      repository: "OmniRoute",
      commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad",
      files: ["open-sse/config/ocrRegistry.ts", "open-sse/handlers/ocr.ts"],
      registryFields: { id: "mistral", baseUrl: MISTRAL_OCR_URL, authType: "apikey", authHeader: "bearer" },
    });
    expect(REGISTRATION.vendorContract.openapi).toMatchObject({ operationId: "ocr_v1_ocr_post", path: "POST /v1/ocr" });
    expect(REGISTRATION.supportedSubset.options).toEqual([...MISTRAL_OCR_OPTION_FIELDS]);
  });

  it("documents every export of the module", () => {
    expect(Object.keys(REGISTRATION.exports).sort()).toEqual(Object.keys(mistralOcr).sort());
  });

  it("is imported by nothing in production and leaves the provider registry untouched", () => {
    let listed = "";
    try {
      listed = execFileSync("git", ["grep", "-l", "native-ocr-mistral", "--", "open-sse", "src", "cli"], { cwd: ROOT, encoding: "utf8" });
    } catch (error) {
      if (error.status !== 1) throw error; // 1: no match
    }
    const hits = listed.trim().split("\n").filter(Boolean);
    expect(hits.every((file) => file.startsWith(`${MODULE_DIR}/`))).toBe(true);
    const registry = readFileSync(new URL("open-sse/providers/registry/mistral.js", ROOT), "utf8");
    expect(registry).not.toMatch(/mistral-ocr|"ocr"|ocrConfig/);
  });
});
