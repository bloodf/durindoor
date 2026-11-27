// Closed synthetic tests of retained transport primitives. These establish
// local safety properties only; no invented vendor success envelope is used.
import { afterEach, expect, it, vi } from "vitest";
import {
  boundedFetch, fireworksAcceptedJob, fireworksHeaders, fireworksPublicUrl,
  fireworksToken, provenUnsent, readJsonObject, redirectState, refusedAnswer,
} from "../../open-sse/services/providerParity/native-fireworks-image/http.js";
import { createFireworksImageAdapter } from "../../open-sse/services/providerParity/native-fireworks-image/index.js";
const KEY_A = "fw-SYNTHETIC-a";
const KEY_B = "fw-SYNTHETIC-b";
const ORIGIN = "https://api.fireworks.ai";
const json = value => new Response(JSON.stringify(value));
afterEach(() => vi.unstubAllGlobals());
it.each([undefined, {}, { apiKey: "" }, { apiKey: "x\r\ny" }])("refuses invalid credential headers %j", credentials => {
  expect(fireworksToken(credentials)).toBeNull();
});
it("keeps selected account credentials isolated", () => {
  expect(fireworksHeaders(fireworksToken({ apiKey: KEY_A, accessToken: KEY_B })).Authorization).toBe(`Bearer ${KEY_A}`);
  expect(fireworksHeaders(fireworksToken({ accessToken: KEY_B })).Authorization).toBe(`Bearer ${KEY_B}`);
});
it.each(["http://example.com/a", "https://10.0.0.1/a", "https://127.0.0.1/a", "https://[::1]/a", "https://u:p@example.com/a", "javascript:alert(1)", "https://localhost/a", "x", "https://example.com/" + "a".repeat(4096)])("rejects unsafe result URL %s", url => {
  expect(fireworksPublicUrl(url)).toBeNull();
});
it("validates public HTTPS without fetching artifacts", () => {
  const fetch = vi.fn();vi.stubGlobal("fetch", fetch);
  expect(fireworksPublicUrl("https://images.example.com/a.png")).toBe("https://images.example.com/a.png");
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses redirects and detects foreign answers", () => {
  expect(redirectState(new Response(null, { status: 307 }))).toEqual({ refused: true });
  const foreign = json({}); Object.defineProperty(foreign, "url", { value: "https://evil.example/" });
  expect(redirectState(foreign)).toEqual({ foreign: true });
  const followed = json({}); Object.defineProperty(followed, "redirected", { value: true });
  expect(redirectState(followed)).toEqual({ foreign: true });
});
it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"])("distinguishes unsent %s", code => {
  expect(provenUnsent({ cause: { code } })).toBe(true);
});
it("does not classify a reset as safe to replay", () => {
  expect(provenUnsent({ cause: { code: "ECONNRESET" } })).toBe(false);
  const accepted = fireworksAcceptedJob("image", "submit-unknown");
  expect(accepted.costStatus).toBe("unknown");
  expect(accepted.costSource).toBe("accepted-job");
  expect(accepted.meta.jobState).toBe("submit-unknown");
});
it.each([
  [401, "invalid_api_key", 401, false], [403, "forbidden", 403, false],
  [402, "insufficient_balance", 402, true], [429, "quota_exhausted", 402, true],
  [403, "insufficient_credit", 402, true], [412, "account_suspended", 412, false],
  [429, "rate_limited", 429, false], [400, "bad_size", 400, false],
  [503, "overloaded", 502, false],
])("maps %s per account without leaking upstream data", async (status, code, expected, quota) => {
  const response = new Response(JSON.stringify({ error: { code, message: `echo ${KEY_A} ${KEY_B}` } }), { status, headers: { "retry-after": "30" } });
  const result = await refusedAnswer(response, { modality: "image", label: "generation", timeoutMs: 100, secrets: { apiKey: KEY_A } });
  expect(result.status).toBe(expected);
  expect(Boolean(result.quotaExhausted)).toBe(quota);
  expect(Boolean(result.acceptedJob)).toBe(status >= 500);
  if (status === 429 && !quota) expect(result.response.headers.get("retry-after")).toBeTruthy();
  const text = await result.response.text();
  expect(text).not.toContain(KEY_A); expect(text).not.toContain(KEY_B); expect(text).not.toContain("echo");
});
it("bounds JSON reads by bytes and never quotes the oversized body", async () => {
  await expect(readJsonObject(json({ secret: KEY_A }), { maxBytes: 4, timeoutMs: 100, what: "answer" })).rejects.toThrow("returned an unreadable answer");
});
it("drops malformed JSON parser text", async () => {
  await expect(readJsonObject(new Response(KEY_A), { maxBytes: 100, timeoutMs: 100, what: "answer" })).rejects.toThrow("returned an unreadable answer");
});
it("keeps body-read deadlines armed", async () => {
  const response = new Response(new ReadableStream({ start() {} }));
  await expect(readJsonObject(response, { maxBytes: 100, timeoutMs: 20, what: "answer" })).rejects.toMatchObject({ status: 504 });
});
it("aborts a stalled send at its deadline without replay", async () => {
  let seen;
  const fetch = vi.fn((_url, init) => { seen = init.signal; return new Promise(() => {}); });
  vi.stubGlobal("fetch", fetch);
  await expect(boundedFetch(ORIGIN, { redirect: "manual" }, { timeoutMs: 20 })).rejects.toMatchObject({ name: "TimeoutError" });
  expect(seen.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
});
it("never sends on pre-abort and propagates caller cancellation during send", async () => {
  const before = new AbortController(); before.abort();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(boundedFetch(ORIGIN, {}, { signal: before.signal, timeoutMs: 100 })).rejects.toMatchObject({ notSent: true });
  expect(fetch).not.toHaveBeenCalled();
  const during = new AbortController(); let seen;
  fetch.mockImplementation((_url, init) => { seen = init.signal; queueMicrotask(() => during.abort()); return new Promise(() => {}); });
  await expect(boundedFetch(ORIGIN, {}, { signal: during.signal, timeoutMs: 100 })).rejects.toMatchObject({ name: "AbortError" });
  expect(seen.aborted).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
});
it("blocks concurrent accounts and unsupported inputs before any billable call", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const adapter = createFireworksImageAdapter();
  const results = await Promise.all([KEY_A, KEY_B].flatMap(apiKey => [
    {}, { input_image: "https://example.com/private.png" }, { n: 2 }, { output_format: "gif" },
    { response_format: "url" }, { size: "512x512" }, { stream: true },
  ].map(body => adapter.generate({ model: "accounts/fireworks/flux-1-schnell-fp8", body, credentials: { apiKey } }))));
  expect(results.every(r => r.status === 400 && !r.acceptedJob)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
