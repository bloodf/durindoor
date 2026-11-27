// Native vertex-deepseek-ocr OCR adapter, staged and unregistered (#2034).
// Closed mocks only: every OCR request goes to an injected transport that
// fails the test on anything unexpected, token minting is an injected fake,
// and every credential is synthetic. Source: OmniRoute c71f0065
// open-sse/config/ocrRegistry.ts (VERTEX_DEEPSEEK_TRANSFORMATION) and
// open-sse/handlers/ocr.ts (resolveVertexOcrBaseUrl, resolveVertexOcrAccessToken).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as unit from "../../open-sse/services/providerParity/native-ocr-vertex-deepseek-ocr/index.js";
import {
  VERTEX_DEEPSEEK_OCR_ORIGIN,
  VERTEX_DEEPSEEK_OCR_PROVIDER_ID,
  acceptsVertexDeepseekOcrModel,
  createVertexDeepseekOcrAdapter,
  isRetiredVertexDeepseekOcrModel,
  parseVertexDeepseekOcrResponse,
  resolveVertexOcrToken,
  runVertexDeepseekOcr,
  vertexDeepseekOcrScope,
} from "../../open-sse/services/providerParity/native-ocr-vertex-deepseek-ocr/index.js";

const ROOT = new URL("../../", import.meta.url);
const MODULE_DIR = "open-sse/services/providerParity/native-ocr-vertex-deepseek-ocr";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${MODULE_DIR}/registration.json`, ROOT), "utf8"));

const TOKEN_A = "SYNTHETIC-vertex-token-a-0001";
const TOKEN_B = "SYNTHETIC-vertex-token-b-0002";
const MINTED = "SYNTHETIC-minted-token-0003";
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nSYNTHETIC0004\n-----END PRIVATE KEY-----\n";
const SA_JSON = JSON.stringify({ type: "service_account", project_id: "proj-from-sa", client_email: "ocr@proj-from-sa.iam.gserviceaccount.com", private_key: PRIVATE_KEY });
const ADC_JSON = JSON.stringify({ type: "authorized_user", client_id: "SYNTHETIC-client", client_secret: "SYNTHETIC-secret-0005", refresh_token: "SYNTHETIC-refresh-0006", quota_project_id: "proj-from-adc" });

const endpoint = (project, region = "us-central1") =>
  `${VERTEX_DEEPSEEK_OCR_ORIGIN}/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`;
const DOC_URL = "https://files.example.org/scan.png";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
const PDF_B64 = Buffer.from("%PDF-1.7 synthetic").toString("base64");

const CRED_A = { accessToken: TOKEN_A, providerSpecificData: { project: "proj-ocr-a" }, connectionId: "conn-a" };
const CRED_B = { accessToken: TOKEN_B, providerSpecificData: { project: "proj-ocr-b", region: "europe-west4" }, connectionId: "conn-b" };
const body = (extra = {}) => ({ model: "my-deployed-ocr", document: { type: "document_url", document_url: DOC_URL }, ...extra });

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const chat = (content, extra = {}) => json({ id: "chatcmpl-1", model: "my-deployed-ocr", choices: [{ index: 0, message: { role: "assistant", content } }], usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 }, ...extra });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${TOKEN_A} ${MINTED} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });
const hang = () => new Promise(() => {});

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

/** Fake minter: records each call and answers with `token` (or the function's result). */
function minter(token = MINTED) {
  const calls = [];
  const mintToken = async (credential, ctx) => {
    calls.push({ credential, ctx });
    return typeof token === "function" ? token(credential, ctx) : token;
  };
  return { mintToken, calls };
}

async function run(answers, args = {}) {
  const t = transport(...answers);
  const m = args.minter ?? minter();
  const result = await runVertexDeepseekOcr({
    body: body(),
    credentials: CRED_A,
    fetchImpl: t.fetchImpl,
    sleepImpl: async () => {},
    mintToken: m.mintToken,
    ...args,
  });
  return { result, calls: t.calls, mints: m.calls };
}

async function errorText(result) {
  return `${result.error ?? ""} ${result.response ? await result.response.clone().text() : ""}`;
}

async function expectNoLeak(result) {
  const text = await errorText(result);
  for (const secret of [TOKEN_A, TOKEN_B, MINTED, "SYNTHETIC0004", "SYNTHETIC-secret-0005", "SYNTHETIC-refresh-0006", "/srv/app"]) {
    expect(text).not.toContain(secret);
  }
}

describe("vertex-deepseek-ocr request protocol (source VERTEX_DEEPSEEK_TRANSFORMATION)", () => {
  it("sends the source chat-completions body to the project/region endpoint with a Bearer token", async () => {
    const { result, calls } = await run([chat("# Page one\n\ntext")]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(endpoint("proj-ocr-a"));
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({
      model: "my-deployed-ocr",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: DOC_URL }] }],
    });
    expect(result).toMatchObject({ success: true, status: 200, provider: VERTEX_DEEPSEEK_OCR_PROVIDER_ID, model: "my-deployed-ocr" });
    expect(result.body).toEqual({
      model: "my-deployed-ocr",
      pages: [{ index: 0, markdown: "# Page one\n\ntext" }],
      usage_info: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
    });
    expect(await result.response.json()).toEqual(result.body);
    expect(result.document).toEqual({ type: "document_url", source: "url", url: DOC_URL });
  });

  it("sends image_url documents, including { url }, as the same single image_url part", async () => {
    const { calls } = await run([chat("a")], { body: body({ document: { type: "image_url", image_url: { url: DOC_URL } } }) });
    expect(calls[0].body.messages[0].content).toEqual([{ type: "image_url", image_url: DOC_URL }]);
  });

  it("forwards an inline image as its data URL and never reports the bytes back", async () => {
    const dataUrl = `data:image/png;base64,${PNG_B64}`;
    const { result, calls } = await run([chat("img")], { body: body({ document: { image_url: dataUrl } }) });
    expect(calls[0].body.messages[0].content[0]).toEqual({ type: "image_url", image_url: dataUrl });
    expect(result.document).toEqual({ type: "image_url", source: "inline", mediaType: "image/png", bytes: 7 });
    expect(JSON.stringify(result.body)).not.toContain(PNG_B64);
  });

  it("strips the provider prefix and sends the deployed model id as supplied", async () => {
    const { calls, result } = await run([chat("x", { model: undefined })], { body: body({ model: "vertex-deepseek-ocr/deepseek-ai/DeepSeek-OCR" }) });
    expect(calls[0].body.model).toBe("deepseek-ai/DeepSeek-OCR");
    expect(result.body.model).toBe("deepseek-ai/DeepSeek-OCR");
  });

  it("has no built-in model and accepts only plain deployed ids", () => {
    const adapter = createVertexDeepseekOcrAdapter({ project: "proj-ocr-a", region: "us-central1", token: TOKEN_A });
    expect(adapter.models).toEqual([]);
    expect(adapter.origins).toEqual([VERTEX_DEEPSEEK_OCR_ORIGIN]);
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(adapter.pollUrl).toBeNull();
    expect(acceptsVertexDeepseekOcrModel("my-deployed-ocr")).toBe(true);
    expect(acceptsVertexDeepseekOcrModel("deepseek-ai/deepseek-ocr@001")).toBe(true);
    for (const id of ["", "a b", "-lead", "a//b", "deepseek-ocr-maas", 7, null]) expect(acceptsVertexDeepseekOcrModel(id)).toBe(false);
  });

  it("ignores an Operation-Location header: the endpoint is synchronous and nothing is polled", async () => {
    const answer = json({ model: "m", choices: [{ message: { content: "sync" } }] }, 200, { "operation-location": `${VERTEX_DEEPSEEK_OCR_ORIGIN}/v1/operations/1` });
    const { result, calls } = await run([answer]);
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("vertex-deepseek-ocr retired managed model (source #20423)", () => {
  it.each([
    "deepseek-ocr-maas",
    "vertex-deepseek-ocr/deepseek-ocr-maas",
    "deepseek-ai/deepseek-ocr-maas",
    "publishers/deepseek-ai/models/deepseek-ocr-maas",
    "DeepSeek-OCR-MaaS",
  ])("refuses %s locally before minting or sending", async (model) => {
    const m = minter();
    const { result, calls, mints } = await run([], {
      body: body({ model }),
      credentials: { apiKey: SA_JSON },
      minter: m,
    });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.error).toMatch(/retired by Google on 2026-10-21/);
    expect(calls).toHaveLength(0);
    expect(mints).toHaveLength(0);
  });

  it("recognizes the retired id in any qualification and nothing else", () => {
    expect(isRetiredVertexDeepseekOcrModel("deepseek-ocr-maas")).toBe(true);
    expect(isRetiredVertexDeepseekOcrModel("deepseek-ai/deepseek-ocr-maas")).toBe(true);
    expect(isRetiredVertexDeepseekOcrModel("deepseek-ocr")).toBe(false);
    expect(isRetiredVertexDeepseekOcrModel("deepseek-ocr-maas-mirror")).toBe(false);
  });
});

describe("vertex-deepseek-ocr document and request safety (nothing is sent)", () => {
  const refused = async (requestBody, pattern) => {
    const { result, calls, mints } = await run([], { body: requestBody, credentials: { apiKey: SA_JSON } });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    if (pattern) expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
    expect(mints).toHaveLength(0);
  };

  it("requires a document and a model", async () => {
    await refused({ model: "my-deployed-ocr" }, /document is required/);
    await refused({ document: { document_url: DOC_URL } }, /need a model/);
  });

  it.each([
    ["http URL", "http://files.example.org/a.png"],
    ["gs:// URL", "gs://bucket/a.png"],
    ["loopback", "https://127.0.0.1/a.png"],
    ["metadata host", "https://169.254.169.254/computeMetadata/v1/"],
    ["localhost", "https://localhost/a.png"],
    ["userinfo", "https://user:pw@files.example.org/a.png"],
    ["over-long URL", `https://files.example.org/${"a".repeat(9000)}`],
  ])("refuses a %s document", async (_name, url) => {
    await refused(body({ document: { document_url: url } }));
  });

  it("refuses inline PDFs and non-base64 data URLs: the document is an image part", async () => {
    await refused(body({ document: { document_url: `data:application/pdf;base64,${PDF_B64}` } }), /does not accept application\/pdf/);
    await refused(body({ document: { document_url: "data:image/png,raw" } }), /base64/);
    await refused(body({ document: { document_url: "data:text/html;base64,PGI+" } }));
  });

  it("refuses fields the source never forwards", async () => {
    await refused(body({ messages: [{ role: "system", content: "x" }] }), /does not support messages/);
    await refused(body({ temperature: 0 }), /does not support temperature/);
    await refused(body({ document: { document_url: DOC_URL, image_url: DOC_URL } }), /exactly one/);
  });

  it.each(["my model", "../x", "a?b", "x".repeat(257), 7])("refuses unsafe model %j", async (model) => {
    await refused(body({ model }));
  });
});

describe("vertex-deepseek-ocr connection scope (source resolveVertexOcrBaseUrl)", () => {
  it("builds the endpoint from providerSpecificData project and region", async () => {
    const { calls } = await run([chat("x")], { credentials: CRED_B });
    expect(calls[0].url).toBe(endpoint("proj-ocr-b", "europe-west4"));
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it("accepts this fork's projectId/location spellings and refuses conflicting ones", () => {
    expect(vertexDeepseekOcrScope({ accessToken: TOKEN_A, providerSpecificData: { projectId: "proj-fork", location: "asia-southeast1" } }))
      .toMatchObject({ project: "proj-fork", region: "asia-southeast1" });
    expect(vertexDeepseekOcrScope({ accessToken: TOKEN_A, providerSpecificData: { project: "proj-same", projectId: "proj-same" } }).project).toBe("proj-same");
    expect(() => vertexDeepseekOcrScope({ accessToken: TOKEN_A, providerSpecificData: { project: "proj-one1", projectId: "proj-two2" } })).toThrow(/different projects/);
    expect(() => vertexDeepseekOcrScope({ accessToken: TOKEN_A, providerSpecificData: { project: "proj-one1", region: "us-east1", location: "us-west1" } })).toThrow(/different regions/);
  });

  it("derives the project from the Service Account; an explicit project wins", () => {
    expect(vertexDeepseekOcrScope({ apiKey: SA_JSON })).toMatchObject({ project: "proj-from-sa", region: "us-central1" });
    expect(vertexDeepseekOcrScope({ apiKey: SA_JSON, providerSpecificData: { project: "proj-explicit" } }).project).toBe("proj-explicit");
    expect(vertexDeepseekOcrScope({ apiKey: ADC_JSON }).project).toBe("proj-from-adc");
  });

  it.each([
    ["no project for a raw token", { apiKey: "ya29.raw" }, 400, /project id/],
    ["a malformed project", { accessToken: TOKEN_A, providerSpecificData: { project: "Proj/../x" } }, 400, /project id/],
    ["a path-injecting region", { accessToken: TOKEN_A, providerSpecificData: { project: "proj-ocr-a", region: "us-central1/../../x" } }, 400, /regional location/],
    ["the global location", { accessToken: TOKEN_A, providerSpecificData: { project: "proj-ocr-a", region: "global" } }, 400, /regional location/],
    ["a configured dedicated endpoint", { accessToken: TOKEN_A, providerSpecificData: { project: "proj-ocr-a", baseUrl: "https://1234.us-central1-5678.prediction.vertexai.goog" } }, 400, /dedicated endpoint/],
    ["a top-level base URL", { accessToken: TOKEN_A, baseUrl: "https://attacker.example.com", providerSpecificData: { project: "proj-ocr-a" } }, 400, /dedicated endpoint/],
    ["no credential", { providerSpecificData: { project: "proj-ocr-a" } }, 401, /needs an access token/],
    ["an OAuth client JSON", { apiKey: JSON.stringify({ web: { client_id: "x", client_secret: "SYNTHETIC-secret-0005" } }), providerSpecificData: { project: "proj-ocr-a" } }, 401, /not a Service Account/],
    ["a Service Account missing its key", { apiKey: JSON.stringify({ type: "service_account", project_id: "proj-from-sa", client_email: "a@b" }) }, 401, /missing private_key/],
    ["a token with spaces", { accessToken: "bad token", providerSpecificData: { project: "proj-ocr-a" } }, 401, /malformed/],
  ])("refuses %s locally", async (_name, credentials, status, pattern) => {
    const { result, calls, mints } = await run([], { credentials });
    expect(result).toMatchObject({ success: false, status, local: true });
    expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
    expect(mints).toHaveLength(0);
    await expectNoLeak(result);
  });
});

describe("vertex-deepseek-ocr credentials (source resolveVertexOcrAccessToken)", () => {
  it("prefers an existing access token over minting from the Service Account", async () => {
    const { calls, mints } = await run([chat("x")], { credentials: { apiKey: SA_JSON, accessToken: TOKEN_A } });
    expect(mints).toHaveLength(0);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(calls[0].url).toBe(endpoint("proj-from-sa"));
  });

  it("mints a token from a Service Account and sends only that token", async () => {
    const { result, calls, mints } = await run([chat("x")], { credentials: { apiKey: SA_JSON } });
    expect(result.success).toBe(true);
    expect(mints).toHaveLength(1);
    expect(mints[0].credential.sa).toMatchObject({ project_id: "proj-from-sa" });
    expect(mints[0].credential.adc).toBeNull();
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${MINTED}`);
    expect(JSON.stringify(calls[0])).not.toContain("SYNTHETIC0004");
  });

  it("mints from an authorized_user ADC file", async () => {
    const { calls, mints } = await run([chat("x")], { credentials: { apiKey: ADC_JSON } });
    expect(mints[0].credential.adc).toMatchObject({ client_id: "SYNTHETIC-client" });
    expect(calls[0].url).toBe(endpoint("proj-from-adc"));
  });

  it("uses a raw apiKey as an access token (source authHint)", async () => {
    const { calls, mints } = await run([chat("x")], { credentials: { apiKey: "ya29.SYNTHETIC-raw", providerSpecificData: { project: "proj-ocr-a" } } });
    expect(mints).toHaveLength(0);
    expect(calls[0].init.headers.Authorization).toBe("Bearer ya29.SYNTHETIC-raw");
  });

  it("passes the connection's proxy to the minter and the transport", async () => {
    const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.internal:3128" };
    const { calls, mints } = await run([chat("x")], { credentials: { apiKey: SA_JSON, providerSpecificData: proxy } });
    expect(mints[0].ctx.proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.internal:3128" });
    expect(calls[0].proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.internal:3128" });
  });

  it("validates the request before minting", async () => {
    const { mints } = await run([], { credentials: { apiKey: SA_JSON }, body: body({ temperature: 1 }) });
    expect(mints).toHaveLength(0);
  });

  it.each([
    ["a minter error", () => { throw new Error(`mint failed ${PRIVATE_KEY}`); }, 401, /could not be obtained/],
    ["an empty token", () => null, 401, /could not be obtained/],
    ["a malformed token", () => "bad token\n", 401, /could not be obtained/],
  ])("refuses %s locally without sending", async (_name, answer, status, pattern) => {
    const { result, calls } = await run([], { credentials: { apiKey: SA_JSON }, minter: minter(answer) });
    expect(result).toMatchObject({ success: false, status, local: true });
    expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
    await expectNoLeak(result);
  });

  it("bounds minting by its own timeout", async () => {
    const { result, calls } = await run([], { credentials: { apiKey: SA_JSON }, minter: minter(() => hang()), tokenTimeoutMs: 5 });
    expect(result).toMatchObject({ success: false, status: 504, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("stops minting when the caller aborts; nothing is sent", async () => {
    const controller = new AbortController();
    const m = minter(() => {
      setTimeout(() => controller.abort(), 0);
      return hang();
    });
    const { result, calls } = await run([], { credentials: { apiKey: SA_JSON }, minter: m, signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(calls).toHaveLength(0);
  });

  it("refuses minting for an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveVertexOcrToken(vertexDeepseekOcrScope({ apiKey: SA_JSON }), { mintToken: async () => MINTED, signal: controller.signal, timeoutMs: 100 }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps each selected connection's token and project apart", async () => {
    const a = await run([chat("a")], { credentials: CRED_A });
    const b = await run([chat("b")], { credentials: CRED_B });
    expect(a.calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(a.calls[0].url).toBe(endpoint("proj-ocr-a"));
    expect(b.calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
    expect(b.calls[0].url).toBe(endpoint("proj-ocr-b", "europe-west4"));
    expect(JSON.stringify(a.calls)).not.toContain(TOKEN_B);
  });
});

describe("vertex-deepseek-ocr answers (source parseResponse)", () => {
  it("reads a JSON content string in the canonical pages shape, sorted, with its usage_info", async () => {
    const content = JSON.stringify({ model: "deepseek-ocr-v2", pages: [{ index: 1, markdown: "two", extra: 1 }, { index: 0, markdown: "one" }], usage_info: { pages_processed: 2, doc_size_bytes: 9, nested: { a: 1 } } });
    const { result } = await run([chat(`  ${content}\n`)]);
    expect(result.body).toEqual({ model: "deepseek-ocr-v2", pages: [{ index: 0, markdown: "one" }, { index: 1, markdown: "two" }], usage_info: { pages_processed: 2, doc_size_bytes: 9 } });
    expect(result.accounting.nativeUnits.pages).toBe(2);
    expect(result.accounting.meta.nativeUnitsSource).toBe("usage_info.pages_processed");
    expect(result.accounting.costSource).not.toBe("accepted-job");
  });

  it("falls back to the chat usage when the JSON content has no usage_info", () => {
    const parsed = parseVertexDeepseekOcrResponse({ choices: [{ message: { content: JSON.stringify({ pages: [{ index: 0, markdown: "p" }] }) } }], usage: { total_tokens: 5 } }, { model: "m" });
    expect(parsed).toEqual({ pages: [{ index: 0, markdown: "p" }], model: "m", usage_info: { total_tokens: 5 } });
  });

  it("treats non-JSON or page-less JSON content as one markdown page", () => {
    expect(parseVertexDeepseekOcrResponse({ choices: [{ message: { content: "{not json" } }] }, { model: "m" }).pages).toEqual([{ index: 0, markdown: "{not json" }]);
    expect(parseVertexDeepseekOcrResponse({ choices: [{ message: { content: '{"text":"x"}' } }] }, { model: "m" }).pages).toEqual([{ index: 0, markdown: '{"text":"x"}' }]);
    expect(parseVertexDeepseekOcrResponse({ model: "answered", choices: [{ message: { content: "" } }] }, { model: "m" })).toEqual({ pages: [{ index: 0, markdown: "" }], model: "answered", usage_info: undefined });
  });

  it("counts returned pages when usage has no page count", async () => {
    const { result } = await run([chat("md")]);
    expect(result.accounting.nativeUnits.pages).toBe(1);
    expect(result.accounting.meta.nativeUnitsSource).toBe("returned-pages");
  });

  it.each([
    ["no choices", { model: "m", choices: [] }],
    ["array content", { choices: [{ message: { content: [{ type: "text", text: "x" }] } }] }],
    ["null content", { choices: [{ message: { content: null } }] }],
    ["bad embedded pages", { choices: [{ message: { content: JSON.stringify({ pages: [{ index: -1, markdown: "x" }] }) } }] }],
  ])("reports %s as a lost result that must not be replayed", async (_name, answer) => {
    const { result, calls } = await run([json(answer)]);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    expect(calls).toHaveLength(1);
  });

  it("reports an unreadable or oversized answer as a lost result", async () => {
    const notJson = await run([new Response("<html>", { status: 200 })]);
    expect(notJson.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    const big = await run([chat("x".repeat(2048))], { maxResponseBytes: 512 });
    expect(big.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "accepted" } } });
    expect(big.result.error).toMatch(/exceeded 512 bytes/);
  });
});

describe("vertex-deepseek-ocr upstream errors and quota (sent once, never quoted)", () => {
  it.each([
    [401, 401, undefined],
    [403, 403, undefined],
    [400, 400, undefined],
    [404, 404, undefined],
  ])("maps %i to %i without acceptedJob", async (upstream, status) => {
    const { result, calls } = await run([leaky(upstream)]);
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.local).toBeUndefined();
    expect(calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("flags 402 as quota exhausted on this connection", async () => {
    const { result } = await run([leaky(402)]);
    expect(result).toMatchObject({ status: 402, quotaExhausted: true });
    await expectNoLeak(result);
  });

  it("keeps Retry-After evidence on 429 (Vertex RESOURCE_EXHAUSTED)", async () => {
    const { result } = await run([leaky(429, { "retry-after": "30" })]);
    expect(result.status).toBe(429);
    expect(result.rateLimitEvidence).toMatchObject({ source: "retry_after" });
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expect(result.acceptedJob).toBeUndefined();
    await expectNoLeak(result);
  });

  it.each([[500, 502], [503, 503], [504, 502]])("marks %i as submit-unknown and does not replay", async (upstream, status) => {
    const { result, calls } = await run([leaky(upstream)]);
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("refuses to follow a redirect, which would carry the Bearer token elsewhere", async () => {
    const { result, calls } = await run([new Response(null, { status: 307, headers: { location: "https://attacker.example.com/x" } })]);
    expect(result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("treats a pre-connect failure as unsent and a mid-flight failure as submit-unknown", async () => {
    const refused = await run([() => Promise.reject(transportError("ECONNREFUSED"))]);
    expect(refused.result).toMatchObject({ success: false, status: 502 });
    expect(refused.result.acceptedJob).toBeUndefined();
    expect(refused.calls).toHaveLength(1);
    const reset = await run([() => Promise.reject(transportError("ECONNRESET"))]);
    expect(reset.result).toMatchObject({ status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(reset.calls).toHaveLength(1);
    await expectNoLeak(reset.result);
  });
});

describe("vertex-deepseek-ocr abort and deadline", () => {
  it("sends nothing for an already aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, calls } = await run([], { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(calls).toHaveLength(0);
  });

  it("marks an abort after the send as submit-unknown", async () => {
    const controller = new AbortController();
    const { result, calls } = await run([() => {
      setTimeout(() => controller.abort(), 0);
      return hang();
    }], { signal: controller.signal });
    expect(result).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("ends a hanging request at the deadline as submit-unknown", async () => {
    const { result, calls } = await run([() => hang()], { timeoutMs: 20 });
    expect(result).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(calls).toHaveLength(1);
  });

  it("never lets minting outlast the whole request budget", async () => {
    const { result, calls } = await run([], { credentials: { apiKey: SA_JSON }, minter: minter(() => hang()), timeoutMs: 10, tokenTimeoutMs: 60_000 });
    expect(result).toMatchObject({ status: 504, local: true });
    expect(calls).toHaveLength(0);
  });
});

// Staging block: everything below asserts the unregistered state and is the
// only part registration may promote to strict positive identity assertions.
describe("staging: native-ocr-vertex-deepseek-ocr is not registered", () => {
  it("declares a staged, unregistered adapter sourced from OmniRoute c71f0065", () => {
    expect(REGISTRATION).toMatchObject({
      issue: "#2034",
      status: "staged-unregistered",
      kind: "ocr-provider-adapter",
      provider: "vertex-deepseek-ocr",
      module: `${MODULE_DIR}/index.js`,
    });
    expect(REGISTRATION.source).toMatchObject({
      repository: "OmniRoute",
      commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad",
      files: ["open-sse/config/ocrRegistry.ts", "open-sse/handlers/ocr.ts"],
    });
  });

  it("documents every export of the module", () => {
    expect(Object.keys(REGISTRATION.exports).sort()).toEqual(Object.keys(unit).sort());
  });

  it("is imported by nothing in production", () => {
    let listed = "";
    try {
      listed = execFileSync("git", ["grep", "-l", "native-ocr-vertex-deepseek-ocr", "--", "open-sse", "src", "cli"], { cwd: ROOT, encoding: "utf8" });
    } catch (error) {
      if (error.status !== 1) throw error; // 1: no match
    }
    const hits = listed.trim().split("\n").filter(Boolean);
    expect(hits.every((file) => file.startsWith(`${MODULE_DIR}/`))).toBe(true);
  });
});
