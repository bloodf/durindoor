// Native OCR dispatch foundation, staged and unregistered (#2034). Closed
// mocks only: every request goes to an injected transport that fails the test
// on anything unexpected, and every key is synthetic. The two adapters below
// are synthetic fixtures shaped like a synchronous Mistral-style OCR API and an
// asynchronous Adobe-style job API; their origins, header names and bodies are
// test inventions, not vendor contracts. Source: OmniRoute c71f0065
// open-sse/config/ocrRegistry.ts and open-sse/handlers/ocr.ts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as foundation from "../../open-sse/services/providerParity/native-ocr-foundation/index.js";
import {
  OCR_INLINE_MEDIA_TYPES,
  OCR_MAX_INLINE_DOCUMENT_BYTES,
  OCR_POLL_INTERVAL_MS,
  OCR_POLL_MAX_ATTEMPTS,
  createOcrDispatcher,
  defineOcrAdapter,
  normalizeOcrResult,
  ocrReject,
  validateOcrRequest,
} from "../../open-sse/services/providerParity/native-ocr-foundation/index.js";

const ROOT = new URL("../../", import.meta.url);
const MODULE_DIR = "open-sse/services/providerParity/native-ocr-foundation";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${MODULE_DIR}/registration.json`, ROOT), "utf8"));

const SYNC_ORIGIN = "https://ocr-sync.example.com";
const SYNC_URL = `${SYNC_ORIGIN}/v1/ocr`;
const ASYNC_ORIGIN = "https://ocr-jobs.example.com";
const ASYNC_URL = `${ASYNC_ORIGIN}/operation/ocr`;
const KEY_A = "SYNTHETIC-ocr-key-a-0001";
const KEY_B = "SYNTHETIC-ocr-key-b-0002";
const CLIENT_ID = "SYNTHETIC-ocr-client-0003";
const PDF_B64 = Buffer.from("%PDF-1.7 synthetic").toString("base64");
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
const DOC_URL = "https://files.example.org/report.pdf";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ message: `upstream echo ${KEY_A} at /srv/app/index.js:44` }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const hang = () => new Promise(() => {});

/** Synthetic synchronous adapter, Mistral-shaped: Bearer key, JSON body, pages in the answer. */
function syncAdapter(overrides = {}) {
  return defineOcrAdapter({
    id: "sync-ocr",
    label: "SyncOCR",
    origins: [SYNC_ORIGIN],
    models: [{ id: "sync-ocr-latest", name: "Sync OCR" }, { id: "sync-ocr-2512", name: "Sync OCR 2" }],
    options: {
      pages: (value) => {
        if (!Array.isArray(value) || value.some((n) => !Number.isSafeInteger(n) || n < 0)) throw ocrReject("SyncOCR pages must be page indexes");
        return [...value];
      },
      include_image_base64: (value) => {
        if (typeof value !== "boolean") throw new Error(`leak ${KEY_A}`);
        return value;
      },
    },
    authHeaders: (credentials) => (credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : null),
    buildRequest: ({ model, document, options }) => ({
      url: SYNC_URL,
      body: {
        model,
        document: document.source === "url" ? { type: document.type, [document.type]: document.url } : { type: document.type, [document.type]: document.dataUrl },
        ...options,
      },
    }),
    parseResponse: (raw) => raw,
    ...overrides,
  });
}

/** Synthetic asynchronous adapter, Adobe-shaped: client id plus Bearer token, 201 + location, status polling. */
function asyncAdapter(overrides = {}) {
  return defineOcrAdapter({
    id: "async-ocr",
    label: "AsyncOCR",
    origins: [ASYNC_ORIGIN],
    models: [{ id: "async-ocr-v1", name: "Async OCR" }],
    documentTypes: ["document_url"],
    inlineMediaTypes: ["application/pdf"],
    authHeaders: (credentials) => (credentials.accessToken && credentials.providerSpecificData?.clientId
      ? { "x-api-key": credentials.providerSpecificData.clientId, Authorization: `Bearer ${credentials.accessToken}` }
      : null),
    buildRequest: ({ document }) => ({ url: ASYNC_URL, body: { input: document.source === "url" ? { uri: document.url } : { data: document.base64 } } }),
    pollUrl: (response) => response.headers.get("location"),
    pollState: (body) => ({ "in progress": "running", done: "succeeded", failed: "failed" })[body?.status] ?? null,
    parseResponse: (raw, { model }) => ({
      model,
      pages: raw.result.pages.map((page) => ({ index: page.page_number - 1, markdown: page.text })),
      usage_info: { pages_processed: raw.result.pages.length },
    }),
    ...overrides,
  });
}

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
const instantSleep = async (ms) => void sleeps.push(ms);

const SYNC_CRED = { apiKey: KEY_A, connectionId: "conn-a" };
const ASYNC_CRED = { accessToken: KEY_B, providerSpecificData: { clientId: CLIENT_ID }, connectionId: "conn-b" };
const syncBody = (extra = {}) => ({ model: "sync-ocr-latest", document: { type: "document_url", document_url: DOC_URL }, ...extra });
const PAGES_OK = { model: "sync-ocr-latest", pages: [{ index: 1, markdown: "# two", images: [{ id: "x" }] }, { index: 0, markdown: "# one" }], usage_info: { pages_processed: 2, doc_size_bytes: 123, nested: { a: 1 } } };

function dispatcher(answers, options = {}) {
  const t = transport(...answers);
  const d = createOcrDispatcher({ adapters: [syncAdapter(), asyncAdapter()], fetchImpl: t.fetchImpl, sleepImpl: instantSleep, ...options });
  return { ...t, dispatch: d.dispatch, d };
}

async function bodyText(result) {
  return result.response ? await result.response.clone().text() : "";
}

async function expectNoLeak(result) {
  const text = `${result.error ?? ""} ${await bodyText(result)}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("/srv/app");
}

describe("OCR adapter interface", () => {
  it("freezes a valid adapter with source poll defaults", () => {
    const adapter = asyncAdapter();
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(adapter.poll).toEqual({ maxAttempts: OCR_POLL_MAX_ATTEMPTS, intervalMs: OCR_POLL_INTERVAL_MS });
    expect(OCR_POLL_MAX_ATTEMPTS).toBe(30);
    expect(OCR_POLL_INTERVAL_MS).toBe(1000);
    expect(syncAdapter().inlineMediaTypes).toEqual(OCR_INLINE_MEDIA_TYPES);
  });

  it.each([
    ["no id", { id: "" }],
    ["uppercase id", { id: "Sync" }],
    ["http origin", { origins: ["http://ocr-sync.example.com"] }],
    ["origin with path", { origins: [`${SYNC_ORIGIN}/v1`] }],
    ["no origins", { origins: [] }],
    ["missing authHeaders", { authHeaders: undefined }],
    ["pollUrl without pollState", { pollUrl: () => null }],
    ["reserved option", { options: { model: () => 1 } }],
    ["bad media subset", { inlineMediaTypes: ["text/html"] }],
    ["duplicate models", { models: [{ id: "a", name: "A" }, { id: "a", name: "A" }] }],
    ["no models and no passthrough", { models: [] }],
    ["nothing accepted", { acceptsUrl: false, inlineMediaTypes: [] }],
  ])("refuses %s", (_name, overrides) => {
    expect(() => syncAdapter(overrides)).toThrow(TypeError);
  });

  it("refuses adapters that did not come from defineOcrAdapter and duplicate ids", () => {
    expect(() => createOcrDispatcher({ adapters: [{ id: "raw", origins: [] }] })).toThrow(/defineOcrAdapter/);
    expect(() => createOcrDispatcher({ adapters: [syncAdapter(), syncAdapter()] })).toThrow(/duplicate/);
    expect(() => createOcrDispatcher({})).toThrow(TypeError);
  });
});

describe("OCR request validation (nothing is sent)", () => {
  const refused = async (body, pattern) => {
    const { dispatch, calls } = dispatcher([]);
    const result = await dispatch({ provider: "sync-ocr", body, credentials: SYNC_CRED });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    if (pattern) expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
    return result;
  };

  it("requires a document (source rule) and a model (no default)", async () => {
    await refused({ model: "sync-ocr-latest" }, /document is required/);
    await refused({ document: { document_url: DOC_URL } }, /need a model/);
  });

  it("resolves the model for the selected adapter only", () => {
    const adapter = syncAdapter();
    expect(validateOcrRequest(adapter, syncBody({ model: "sync-ocr/sync-ocr-2512" })).model).toBe("sync-ocr-2512");
    expect(validateOcrRequest(adapter, syncBody()).model).toBe("sync-ocr-latest");
    expect(() => validateOcrRequest(adapter, syncBody({ model: "async-ocr-v1" }))).toThrow(/Unsupported OCR model/);
    expect(() => validateOcrRequest(adapter, syncBody({ model: "async-ocr/async-ocr-v1" }))).toThrow(/Unsupported/);
    const passthrough = syncAdapter({ models: [], acceptsModel: (id) => id.startsWith("deployed-") });
    expect(validateOcrRequest(passthrough, syncBody({ model: "deployed-ocr-7" })).model).toBe("deployed-ocr-7");
    expect(() => validateOcrRequest(passthrough, syncBody({ model: "other" }))).toThrow(/Unsupported/);
  });

  it.each(["sync ocr", "../sync-ocr-latest", "sync-ocr/", "a\nb", "a?b", "x".repeat(257), 7])("refuses unsafe model %j", async (model) => {
    await refused(syncBody({ model }));
  });

  it.each([
    ["both fields", { document_url: DOC_URL, image_url: "https://files.example.org/a.png" }, /exactly one/],
    ["no field", { type: "document_url" }, /exactly one/],
    ["type mismatch", { type: "image_url", document_url: DOC_URL }, /does not match/],
    ["unknown field", { document_url: DOC_URL, file_id: "f1" }, /file_id/],
    ["non-string url", { document_url: 7 }, /URL string/],
    ["http url", { document_url: "http://files.example.org/a.pdf" }, /public https/],
    ["loopback", { document_url: "https://127.0.0.1/a.pdf" }, /public https/],
    ["metadata host", { document_url: "https://169.254.169.254/latest" }, /public https/],
    ["localhost", { document_url: "https://localhost/a.pdf" }, /public https/],
    ["internal suffix", { document_url: "https://files.internal/a.pdf" }, /public https/],
    ["private v6", { document_url: "https://[::1]/a.pdf" }, /public https/],
    ["userinfo", { document_url: "https://user:pw@files.example.org/a.pdf" }, /public https/],
    ["file scheme", { document_url: "file:///etc/passwd" }, /public https/],
    ["too long", { document_url: `https://files.example.org/${"a".repeat(9000)}` }, /public https/],
    ["not base64", { document_url: "data:application/pdf;base64,@@@@" }, /base64 data URLs/],
    ["not base64 encoded", { document_url: "data:application/pdf,plain" }, /base64 data URLs/],
    ["html inline", { document_url: `data:text/html;base64,${PDF_B64}` }, /does not accept text\/html/],
    ["pdf as image", { image_url: `data:application/pdf;base64,${PDF_B64}` }, /must be images/],
    ["empty inline", { document_url: "data:application/pdf;base64," }, /base64 data URLs/],
    ["image_url extra", { image_url: { url: "https://files.example.org/a.png", detail: "high" } }, /detail/],
  ])("refuses document with %s", async (_name, document, pattern) => {
    await refused({ model: "sync-ocr-latest", document }, pattern);
  });

  it("refuses an oversized inline document before decoding it", async () => {
    const big = "A".repeat(Math.ceil(OCR_MAX_INLINE_DOCUMENT_BYTES / 3) * 4 + 4);
    await refused({ model: "sync-ocr-latest", document: { document_url: `data:application/pdf;base64,${big}` } }, /must not exceed/);
  });

  it("normalizes url and inline documents without leaking the bytes", () => {
    const adapter = syncAdapter();
    expect(validateOcrRequest(adapter, syncBody({ document: { document_url: `${DOC_URL}#frag` } })).document)
      .toEqual({ type: "document_url", source: "url", url: DOC_URL });
    const inline = validateOcrRequest(adapter, syncBody({ document: { image_url: { url: `data:IMAGE/PNG;base64,${PNG_B64}` } } })).document;
    expect(inline).toMatchObject({ type: "image_url", source: "inline", mediaType: "image/png", bytes: 7, base64: PNG_B64, dataUrl: `data:image/png;base64,${PNG_B64}` });
  });

  it("honors the adapter's document and media narrowing", () => {
    const adapter = asyncAdapter();
    expect(() => validateOcrRequest(adapter, { model: "async-ocr-v1", document: { image_url: "https://files.example.org/a.png" } })).toThrow(/does not accept image_url/);
    expect(() => validateOcrRequest(adapter, { model: "async-ocr-v1", document: { document_url: `data:image/png;base64,${PNG_B64}` } })).toThrow(/does not accept image\/png/);
    const inlineOnly = syncAdapter({ acceptsUrl: false });
    expect(() => validateOcrRequest(inlineOnly, syncBody())).toThrow(/inline documents only/);
    const urlOnly = syncAdapter({ inlineMediaTypes: [] });
    expect(() => validateOcrRequest(urlOnly, syncBody({ document: { document_url: `data:application/pdf;base64,${PDF_B64}` } }))).toThrow(/URLs only/);
  });

  it("refuses undeclared top-level fields and runs option validators", async () => {
    await refused(syncBody({ stream: true }), /does not support stream/);
    await refused(syncBody({ pages: [-1] }), /pages must be page indexes/);
    const leak = await refused(syncBody({ include_image_base64: "yes" }), /include_image_base64 is not valid/);
    await expectNoLeak(leak);
    expect(validateOcrRequest(syncAdapter(), syncBody({ pages: [0, 2], include_image_base64: null })).options).toEqual({ pages: [0, 2] });
    await refused("not an object", /JSON object/);
  });
});

describe("OCR provider selection and auth (nothing is sent)", () => {
  it("dispatches only to a known selected provider", async () => {
    const { dispatch, calls } = dispatcher([]);
    for (const provider of [undefined, "missing", "Bad\nId"]) {
      const result = await dispatch({ provider, body: syncBody(), credentials: SYNC_CRED });
      expect(result).toMatchObject({ status: 400, local: true });
      expect(result.error).toContain("Available: sync-ocr, async-ocr");
      expect(result.error).not.toContain("\n");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses with 401 when the adapter has no usable credentials", async () => {
    const { dispatch, calls } = dispatcher([]);
    const missing = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: {} });
    expect(missing).toMatchObject({ success: false, status: 401 });
    expect(missing.local).toBeUndefined();
    const injected = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: { apiKey: "a\r\nX-Evil: 1" } });
    expect(injected.status).toBe(401);
    const throwing = createOcrDispatcher({
      adapters: [syncAdapter({ authHeaders: () => { throw new Error(KEY_A); } })],
      fetchImpl: transport().fetchImpl,
    });
    const thrown = await throwing.dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(thrown.status).toBe(401);
    await expectNoLeak(thrown);
    expect(calls).toHaveLength(0);
  });

  it("adds no auth of its own: only the adapter's headers are sent", async () => {
    const { dispatch, calls } = dispatcher([json({}, 201, { location: `${ASYNC_ORIGIN}/status/1` }), json({ status: "done", result: { pages: [{ page_number: 1, text: "x" }] } })]);
    const result = await dispatch({ provider: "async-ocr", body: { model: "async-ocr-v1", document: { document_url: DOC_URL } }, credentials: { ...ASYNC_CRED, apiKey: "SYNTHETIC-unused-api-key" } });
    expect(result.success).toBe(true);
    for (const call of calls) {
      expect(call.init.headers["x-api-key"]).toBe(CLIENT_ID);
      expect(call.init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
      expect(JSON.stringify(call.init.headers)).not.toContain("SYNTHETIC-unused-api-key");
    }
  });

  it("never sends to a target outside the adapter's origins", async () => {
    for (const url of ["https://evil.example.net/v1/ocr", "http://ocr-sync.example.com/v1/ocr", "not a url", `https://u:p@ocr-sync.example.com/v1/ocr`]) {
      const t = transport();
      const d = createOcrDispatcher({ adapters: [syncAdapter({ buildRequest: () => ({ url, body: {} }) })], fetchImpl: t.fetchImpl });
      const result = await d.dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
      expect(result).toMatchObject({ status: 500, local: true });
      expect(t.calls).toHaveLength(0);
    }
  });

  it("maps adapter build failures without sending", async () => {
    const t = transport();
    const d = createOcrDispatcher({
      adapters: [
        syncAdapter({ buildRequest: () => { throw ocrReject("SyncOCR needs pages for inline documents"); } }),
        asyncAdapter({ buildRequest: () => { throw new Error(`boom ${KEY_B}`); } }),
      ],
      fetchImpl: t.fetchImpl,
    });
    expect(await d.dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED })).toMatchObject({ status: 400, local: true, error: "SyncOCR needs pages for inline documents" });
    const crashed = await d.dispatch({ provider: "async-ocr", body: { model: "async-ocr-v1", document: { document_url: DOC_URL } }, credentials: ASYNC_CRED });
    expect(crashed).toMatchObject({ status: 500, local: true });
    await expectNoLeak(crashed);
    expect(t.calls).toHaveLength(0);
  });
});

describe("OCR synchronous dispatch (Mistral-shaped fixture)", () => {
  it("sends one bounded POST and normalizes pages, usage and accounting", async () => {
    const { dispatch, calls } = dispatcher([json(PAGES_OK)]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody({ pages: [0, 1] }), credentials: SYNC_CRED });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(SYNC_URL);
    expect(call.init).toMatchObject({ method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" } });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(call.body).toEqual({ model: "sync-ocr-latest", document: { type: "document_url", document_url: DOC_URL }, pages: [0, 1] });
    expect(result).toMatchObject({ success: true, status: 200, provider: "sync-ocr", model: "sync-ocr-latest", document: { type: "document_url", source: "url", url: DOC_URL } });
    expect(result.body).toEqual({
      model: "sync-ocr-latest",
      pages: [{ index: 0, markdown: "# one" }, { index: 1, markdown: "# two" }],
      usage_info: { pages_processed: 2, doc_size_bytes: 123 },
    });
    expect(await result.response.json()).toEqual(result.body);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(result.accounting).toMatchObject({ modality: "ocr", nativeUnits: { pages: 2 }, cost: null, costStatus: "unknown", meta: { nativeUnitsSource: "usage_info.pages_processed" } });
  });

  it("reports an inline document without its bytes and counts returned pages without usage", async () => {
    const { dispatch, calls } = dispatcher([json({ pages: [{ index: 0, markdown: "img" }] })]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody({ document: { image_url: `data:image/png;base64,${PNG_B64}` } }), credentials: SYNC_CRED });
    expect(calls[0].body.document).toEqual({ type: "image_url", image_url: `data:image/png;base64,${PNG_B64}` });
    expect(result.document).toEqual({ type: "image_url", source: "inline", mediaType: "image/png", bytes: 7 });
    expect(JSON.stringify(result.document)).not.toContain(PNG_B64);
    expect(result.body.model).toBe("sync-ocr-latest");
    expect(result.accounting).toMatchObject({ nativeUnits: { pages: 1 }, meta: { nativeUnitsSource: "returned-pages" } });
  });

  it("passes the selected connection's proxy options to the transport", async () => {
    const { dispatch, calls } = dispatcher([json(PAGES_OK)]);
    await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: { ...SYNC_CRED, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.com:8080" } } });
    expect(calls[0].proxyOptions).not.toBeUndefined();
  });

  it.each([
    [400, 400, false],
    [401, 401, false],
    [403, 403, false],
    [404, 404, false],
    [422, 422, false],
    [500, 502, true],
    [502, 502, true],
  ])("maps a %i refusal to %i without quoting the upstream", async (upstream, status, accepted) => {
    const { dispatch } = dispatcher([leaky(upstream)]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ success: false, status });
    expect(result.local).toBeUndefined();
    expect(Boolean(result.acceptedJob)).toBe(accepted);
    if (accepted) expect(result.acceptedJob).toMatchObject({ modality: "ocr", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    await expectNoLeak(result);
    expect(await bodyText(result)).not.toContain("upstream echo");
  });

  it("keeps quota and rate-limit evidence for the selected connection", async () => {
    const { dispatch } = dispatcher([leaky(402), leaky(429, { "retry-after": "30" }), leaky(503, { "retry-after": "60" })]);
    const quota = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(quota).toMatchObject({ status: 402, quotaExhausted: true });
    const limited = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(limited.status).toBe(429);
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(limited.response.headers.get("retry-after")).toBeTruthy();
    const unavailable = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(unavailable).toMatchObject({ status: 503, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(unavailable.resetsAtMs).toBeGreaterThan(Date.now());
    for (const result of [quota, limited, unavailable]) await expectNoLeak(result);
  });

  it("refuses a submit redirect without following it", async () => {
    const { dispatch, calls } = dispatcher([new Response(null, { status: 302, headers: { location: "https://evil.example.net/" } })]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("separates unsent transport failures from sent ones", async () => {
    const unsent = await dispatcher([() => Promise.reject(transportError("ENOTFOUND"))]).dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(unsent).toMatchObject({ status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    await expectNoLeak(unsent);
    const sent = await dispatcher([() => Promise.reject(transportError("ECONNRESET"))]).dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(sent).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    await expectNoLeak(sent);
  });

  it("does not send when the caller already left", async () => {
    const { dispatch, calls } = dispatcher([]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED, signal: AbortSignal.abort() });
    expect(result).toMatchObject({ status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("ends on the deadline even when the transport ignores its signal", async () => {
    const { dispatch } = dispatcher([hang], { timeoutMs: 20 });
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
  });

  it("ends on a caller abort after the send", async () => {
    const controller = new AbortController();
    const { dispatch } = dispatcher([() => { setTimeout(() => controller.abort(), 5); return hang(); }]);
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED, signal: controller.signal });
    expect(result).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(result.local).toBeUndefined();
  });

  it("ends a stalled 2xx body on the deadline as an accepted job", async () => {
    const stalled = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"pages\":")); } }), { status: 200 });
    const { dispatch } = dispatcher([stalled], { timeoutMs: 20 });
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "accepted" } } });
  });

  it.each([
    ["non-JSON", () => new Response("<html>", { status: 200 }), /not JSON/],
    ["oversized", () => json({ pages: [{ index: 0, markdown: "x".repeat(2048) }] }), /exceeded 1024 bytes/],
    ["missing pages", () => json({ text: "x" }), /result shape/],
    ["duplicate index", () => json({ pages: [{ index: 0, markdown: "a" }, { index: 0, markdown: "b" }] }), /result shape/],
    ["negative index", () => json({ pages: [{ index: -1, markdown: "a" }] }), /result shape/],
    ["non-string markdown", () => json({ pages: [{ index: 0, markdown: 1 }] }), /result shape/],
  ])("treats a %s 2xx answer as a lost accepted job", async (_name, answer, pattern) => {
    const { dispatch } = dispatcher([answer()], { maxResponseBytes: 1024 });
    const result = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { costSource: "accepted-job", meta: { jobState: "accepted" } } });
    expect(result.error).toMatch(pattern);
  });

  it("treats a throwing parseResponse as a lost accepted job", async () => {
    const t = transport(json(PAGES_OK));
    const d = createOcrDispatcher({ adapters: [syncAdapter({ parseResponse: () => { throw new Error(KEY_A); } })], fetchImpl: t.fetchImpl });
    const result = await d.dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    await expectNoLeak(result);
  });
});

describe("OCR asynchronous dispatch (Adobe-shaped fixture)", () => {
  const body = { model: "async-ocr-v1", document: { document_url: DOC_URL } };
  const submitted = (location = `${ASYNC_ORIGIN}/status/job-1`) => json({}, 201, { location });
  const running = () => json({ status: "in progress" });
  const done = () => json({ status: "done", result: { pages: [{ page_number: 2, text: "b" }, { page_number: 1, text: "a" }] } });

  it("submits once, polls the status URL with the same auth, and normalizes the result", async () => {
    sleeps.length = 0;
    const { dispatch, calls } = dispatcher([submitted(), running(), running(), done()]);
    const result = await dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", ASYNC_URL],
      ["GET", `${ASYNC_ORIGIN}/status/job-1`],
      ["GET", `${ASYNC_ORIGIN}/status/job-1`],
      ["GET", `${ASYNC_ORIGIN}/status/job-1`],
    ]);
    expect(calls[0].body).toEqual({ input: { uri: DOC_URL } });
    for (const call of calls.slice(1)) {
      expect(call.init).toMatchObject({ redirect: "manual", headers: { "x-api-key": CLIENT_ID, Authorization: `Bearer ${KEY_B}` } });
      expect(call.init.body).toBeUndefined();
    }
    expect(sleeps).toEqual([OCR_POLL_INTERVAL_MS, OCR_POLL_INTERVAL_MS, OCR_POLL_INTERVAL_MS]);
    expect(result).toMatchObject({ success: true, provider: "async-ocr", model: "async-ocr-v1" });
    expect(result.body).toEqual({ model: "async-ocr-v1", pages: [{ index: 0, markdown: "a" }, { index: 1, markdown: "b" }], usage_info: { pages_processed: 2 } });
    expect(result.accounting.nativeUnits).toEqual({ pages: 2 });
  });

  it("resolves a relative status URL against the submit URL", async () => {
    const { dispatch, calls } = dispatcher([submitted("/status/job-2"), done()]);
    const result = await dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(result.success).toBe(true);
    expect(calls[1].url).toBe(`${ASYNC_ORIGIN}/status/job-2`);
  });

  it.each([
    "https://evil.example.net/status/job-1",
    "http://ocr-jobs.example.com/status/job-1",
    "https://127.0.0.1/status",
    "https://user:pw@ocr-jobs.example.com/status",
  ])("never polls a status URL outside the submit origin: %s", async (location) => {
    const { dispatch, calls } = dispatcher([submitted(location)]);
    const result = await dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(calls).toHaveLength(1);
  });

  it("refuses a poll redirect, a refused poll, a failed job and an unknown state as accepted jobs", async () => {
    const cases = [
      [new Response(null, { status: 307, headers: { location: "https://evil.example.net/" } }), /redirect/],
      [leaky(500), /status check failed with 500/],
      [json({ status: "failed", error: KEY_A }), /analysis failed/],
      [json({ status: "mystery" }), /not understood/],
      [new Response("<html>", { status: 200 }), /could not be read/],
    ];
    for (const [answer, pattern] of cases) {
      const { dispatch, calls } = dispatcher([submitted(), answer]);
      const result = await dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
      expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
      expect(result.error).toMatch(pattern);
      await expectNoLeak(result);
      expect(calls).toHaveLength(2);
    }
  });

  it("stops after the adapter's poll attempts with a 504", async () => {
    const t = transport(submitted(), running(), running(), running());
    const d = createOcrDispatcher({ adapters: [asyncAdapter({ poll: { maxAttempts: 3, intervalMs: 5 } })], fetchImpl: t.fetchImpl, sleepImpl: instantSleep });
    const result = await d.dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(t.calls).toHaveLength(4);
  });

  it("ends polling on the shared deadline, even inside a sleep", async () => {
    const t = transport(submitted(), running());
    const d = createOcrDispatcher({ adapters: [asyncAdapter()], fetchImpl: t.fetchImpl, sleepImpl: (ms) => (ms ? hang() : undefined), timeoutMs: 20 });
    const result = await d.dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(t.calls).toHaveLength(1);
  });

  it("returns a synchronous answer when the adapter reports no status URL", async () => {
    const t = transport(json({ status: "done", result: { pages: [{ page_number: 1, text: "now" }] } }));
    const d = createOcrDispatcher({ adapters: [asyncAdapter({ pollUrl: () => null })], fetchImpl: t.fetchImpl, sleepImpl: instantSleep });
    const result = await d.dispatch({ provider: "async-ocr", body, credentials: ASYNC_CRED });
    expect(result.body.pages).toEqual([{ index: 0, markdown: "now" }]);
    expect(t.calls).toHaveLength(1);
  });

  it("dispatches to the selected provider when several are present", async () => {
    const { dispatch, calls } = dispatcher([json(PAGES_OK)]);
    const wrongModel = await dispatch({ provider: "async-ocr", body: syncBody(), credentials: ASYNC_CRED });
    expect(wrongModel).toMatchObject({ status: 400, local: true });
    expect(calls).toHaveLength(0);
    const right = await dispatch({ provider: "sync-ocr", body: syncBody(), credentials: SYNC_CRED });
    expect(right.provider).toBe("sync-ocr");
    expect(calls[0].url).toBe(SYNC_URL);
  });
});

describe("OCR result normalization", () => {
  it("keeps index and markdown, sorts pages and filters usage to primitives", () => {
    expect(normalizeOcrResult({ model: "", pages: [{ index: 2, markdown: "c", extra: 1 }, { index: 0, markdown: "" }], usage_info: { a: 1, b: "x", c: { d: 1 }, e: Number.NaN } }, { model: "m" }))
      .toEqual({ model: "m", pages: [{ index: 0, markdown: "" }, { index: 2, markdown: "c" }], usage_info: { a: 1, b: "x" } });
    expect(normalizeOcrResult({ pages: [] }, { model: "m" })).toEqual({ model: "m", pages: [] });
    expect(normalizeOcrResult(null, { model: "m" })).toBeNull();
    expect(normalizeOcrResult({ pages: [{ index: 1.5, markdown: "x" }] }, { model: "m" })).toBeNull();
  });
});

// Staging block: everything below asserts the unregistered state and is the
// only part registration may promote to strict positive identity assertions.
describe("staging: native-ocr-foundation is not registered", () => {
  it("declares a staged, unregistered foundation sourced from OmniRoute c71f0065", () => {
    expect(REGISTRATION).toMatchObject({ issue: "#2034", status: "staged-unregistered", kind: "foundation", module: `${MODULE_DIR}/index.js` });
    expect(REGISTRATION.source).toMatchObject({
      repository: "OmniRoute",
      commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad",
      files: ["open-sse/config/ocrRegistry.ts", "open-sse/handlers/ocr.ts"],
    });
  });

  it("documents every export of the module", () => {
    expect(Object.keys(REGISTRATION.exports).sort()).toEqual(Object.keys(foundation).sort());
  });

  it("stages no provider entry, model or auth", () => {
    const sources = execFileSync("git", ["ls-files", MODULE_DIR], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith(".js"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      // Code only: comments cite the source registry by name.
      const text = readFileSync(new URL(file, ROOT), "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join("\n");
      expect(text).not.toMatch(/https:\/\/api\.mistral\.ai|documentintelligence|aiplatform\.googleapis|adobe\.io|Ocp-Apim/);
      expect(text).not.toMatch(/mistral-ocr-latest|prebuilt-read/);
    }
  });

  it("is imported by nothing in production", () => {
    let listed = "";
    try {
      listed = execFileSync("git", ["grep", "-l", "native-ocr-foundation", "--", "open-sse", "src", "cli"], { cwd: ROOT, encoding: "utf8" });
    } catch (error) {
      if (error.status !== 1) throw error; // 1: no match
    }
    const hits = listed.trim().split("\n").filter(Boolean);
    expect(hits.every((file) => file.startsWith(`${MODULE_DIR}/`))).toBe(true);
  });
});
