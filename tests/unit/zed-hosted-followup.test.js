// Local contract hardening around the pinned OmniRoute Zed protocol. No live calls.
import { afterEach, expect, it, vi } from "vitest";
import { clearZedCaches, fetchZedLlmToken, zedLlmFetch, resolveZedModels } from "../../open-sse/shared/zedHostedAuth.js";
import { ZedHostedExecutor, wrapZedCompletionStream } from "../../open-sse/executors/zed-hosted.js";
import "../translator/registerAll.js";
const account = (systemId = "client-a", token = "synthetic-access") => ({
  id: "selected-account", accessToken: token,
  providerSpecificData: { userId: "u", organizationId: "o", systemId, enableSessionDispatch: true },
});
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
afterEach(() => { clearZedCaches(); vi.useRealTimers(); });

it("separates identical credentials across clients, selected accounts, proxies and rotations", async () => {
  const fetch = vi.fn(async () => json({ token: `llm-${fetch.mock.calls.length}` }));
  const a = account();
  const first = await fetchZedLlmToken(a, { fetch });
  expect(await fetchZedLlmToken(a, { fetch })).toBe(first);
  const variants = [
    [account("client-b"), {}],
    [{ ...a, id: "other-account" }, {}],
    [a, { proxyOptions: { proxyPoolId: "private-route" } }],
    [account("client-a", "rotated-access"), {}],
  ];
  for (const [credentials, options] of variants) {
    expect(await fetchZedLlmToken(credentials, { fetch, ...options })).not.toBe(first);
  }
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("separates catalog caches by client and proxy", async () => {
  const fetch = vi.fn(async (url) => url.endsWith("/models")
    ? json({ models: [{ id: `model-${fetch.mock.calls.length}` }] }) : json({ token: "llm" }));
  const a = await resolveZedModels(account(), { fetch });
  const b = await resolveZedModels(account("other-client"), { fetch });
  const c = await resolveZedModels(account(), { fetch, proxyOptions: { proxyPoolId: "other" } });
  expect(a.models).not.toEqual(b.models);
  expect(a.models).not.toEqual(c.models);
});

it("does not replay accepted completions carrying an expiry hint", async () => {
  const fetch = vi.fn(async (url) => url.endsWith("/client/llm_tokens") ? json({ token: "llm" })
    : new Response("accepted-output", { headers: { "x-zed-expired-token": "true" } }));
  const response = await zedLlmFetch(account(), "/completions", { fetch });
  expect(await response.text()).toBe("accepted-output");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retries explicit credential rejection once and never retries uncertain network acceptance", async () => {
  let completions = 0;
  const fetch = vi.fn(async (url) => {
    if (url.endsWith("/client/llm_tokens")) return json({ token: "llm" });
    completions++;
    return json({}, 401);
  });
  expect((await zedLlmFetch(account(), "/completions", { fetch })).status).toBe(401);
  expect(completions).toBe(2);
  clearZedCaches();
  completions = 0;
  fetch.mockImplementation(async (url) => {
    if (url.endsWith("/client/llm_tokens")) return json({ token: "llm" });
    completions++;
    throw new TypeError("connection closed after acceptance");
  });
  await expect(zedLlmFetch(account(), "/completions", { fetch })).rejects.toThrow();
  expect(completions).toBe(1);
});

it("rejects configurable credential endpoints before transport and requests no redirects", async () => {
  const fetch = vi.fn(async (_url, init) => {
    expect(init.redirect).toBe("error");
    return json({ token: "llm" });
  });
  await expect(fetchZedLlmToken(account(), { fetch, config: { cloudBaseUrl: "https://other.invalid" } }))
    .rejects.toMatchObject({ code: "zed_hosted_endpoint_invalid" });
  expect(fetch).not.toHaveBeenCalled();
  await fetchZedLlmToken(account(), { fetch });
});

it.each([401, 403, 429, 500])("redacts upstream status %s in token and executor errors", async (status) => {
  const fetch = vi.fn(async () => json({ message: "secret-access-token", error: { message: "secret" } }, status));
  await expect(fetchZedLlmToken(account(), { fetch })).rejects.toThrow(`HTTP ${status}`);
  try { await fetchZedLlmToken(account(), { fetch }); } catch (error) {
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(error.body).toBeUndefined();
  }
  const parsed = new ZedHostedExecutor().parseError(new Response(null, { status }), '{"message":"secret-access-token"}');
  expect(parsed.message).not.toContain("secret");
});

it("redacts a failed stream before output without replay", async () => {
  const response = wrapZedCompletionStream(new Response('{"status":{"failed":{"message":"secret-access-token"}}}\n'), "anthropic", "claude");
  const text = await response.text();
  expect(text).toContain("ZED_STREAM_FAILED");
  expect(text).not.toContain("secret");
});

it("honors cancellation even with a cached token and bounds transport lifetime", async () => {
  const fetch = vi.fn(async (_url, init) => {
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return json({ token: "llm" });
  });
  await fetchZedLlmToken(account(), { fetch });
  const controller = new AbortController();
  controller.abort();
  await expect(fetchZedLlmToken(account(), { fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  await expect(zedLlmFetch(account(), "/completions", { fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("never commits a token returned by a transport after cancellation", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => {
    controller.abort();
    return json({ token: "cancelled-token" });
  });
  await expect(fetchZedLlmToken(account(), { fetch, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  fetch.mockImplementation(async () => json({ token: "fresh-token" }));
  expect(await fetchZedLlmToken(account(), { fetch })).toBe("fresh-token");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves delivered output then fails a stream without a second completion", async () => {
  const chunk = { choices: [{ index: 0, delta: { content: "delivered" }, finish_reason: null }] };
  const response = wrapZedCompletionStream(new Response(
    `${JSON.stringify({ event: chunk })}\n${JSON.stringify({ status: { failed: { message: "secret" } } })}\n`
  ), "x_ai", "grok");
  const reader = response.body.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("delivered");
  await expect(reader.read()).rejects.toThrow("Zed upstream stream failed");
});

it("redacts the real executor's rejected completion response", async () => {
  const fetch = vi.fn(async (url) => {
    if (url.endsWith("/client/llm_tokens")) return json({ token: "llm" });
    if (url.endsWith("/models")) return json({ models: [{ id: "grok", provider: "x_ai" }] });
    return json({ message: "secret-access-token" }, 429, { "retry-after": "12" });
  });
  const result = await new ZedHostedExecutor({ fetch }).execute({
    model: "grok", body: { messages: [{ role: "user", content: "hello" }] }, stream: true, credentials: account(),
  });
  expect(result.response.status).toBe(429);
  expect(result.response.headers.get("retry-after")).toBe("12");
  expect(await result.response.text()).not.toContain("secret");
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("/completions"))).toHaveLength(1);
});

it("enforces the 30-second deadline signal at the transport boundary", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    deadline.abort(new DOMException("deadline", "TimeoutError"));
  }));
  try {
    await expect(fetchZedLlmToken(account(), { fetch })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { timeout.mockRestore(); }
});
