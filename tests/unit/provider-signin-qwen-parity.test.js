import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQwenProviderHandlers } from "../../src/lib/oauth/providerParity/qwen/index.js";
import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";
import { QwenService } from "../../src/lib/oauth/services/qwen.js";
import { refreshQwenToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import qwen from "../../open-sse/providers/registry/qwen.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("production Qwen contracts", () => {
  it("binds each device exchange to its verifier and proxy", async () => {
    const fetch = vi.fn().mockImplementation(async (_url, options) => {
      const form = Object.fromEntries(options.body);
      return json(form.device_code ? { access_token: `token-${form.device_code}`, resource_url: `${form.device_code}.example` } : { device_code: form.code_challenge });
    });
    vi.stubGlobal("fetch", fetch);
    const proxies = [{ proxyUrl: "http://one" }, { proxyUrl: "http://two" }];
    await Promise.all(proxies.map((proxy, i) => requestDeviceCode("qwen", `challenge-${i}`, {}, proxy)));
    const results = await Promise.all(proxies.map((proxy, i) => pollForToken("qwen", `device-${i}`, `verifier-${i}`, {}, proxy)));
    expect(results.map((r) => r.tokens.accessToken)).toEqual(["token-device-0", "token-device-1"]);
    const calls = fetch.mock.calls.slice(2).map(([, options]) => ({ form: Object.fromEntries(options.body), proxy: options.proxyOptions }));
    expect(calls).toMatchObject([{ form: { device_code: "device-0", code_verifier: "verifier-0" }, proxy: proxies[0] }, { form: { device_code: "device-1", code_verifier: "verifier-1" }, proxy: proxies[1] }]);
  });

  it.each(["authorization_pending", "slow_down", "expired_token", "access_denied"])("returns %s without retrying", async (error) => {
    const fetch = vi.fn().mockResolvedValue(json({ error }, 400));
    vi.stubGlobal("fetch", fetch);
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: false, error });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses each account's resource host and token for streaming", () => {
    const executor = new QwenExecutor();
    for (const id of ["one", "two"]) {
      const credentials = { accessToken: `token-${id}`, providerSpecificData: { resourceUrl: `${id}.example` } };
      expect(executor.buildUrl("coder-model", true, 0, credentials)).toBe(`https://${id}.example/v1/chat/completions`);
      expect(executor.buildHeaders(credentials, true)).toMatchObject({ Authorization: `Bearer token-${id}`, Accept: "text/event-stream" });
    }
    expect(qwen.models.map(({ id }) => id)).toContain("coder-model");
  });
  it("refreshes two accounts independently and rejects a bad refresh", async () => {
    proxyAwareFetch.mockImplementation(async (_url, options) => {
      const token = options.body.get("refresh_token");
      return token === "bad" ? json({ error: "invalid_grant", detail: "secret-upstream" }, 401) : json({ access_token: `new-${token}`, resource_url: `${token}.example` });
    });
    const proxies = [{ proxyUrl: "http://one" }, { proxyUrl: "http://two" }];
    const result = await Promise.all([refreshQwenToken("one", null, proxies[0]), refreshQwenToken("two", null, proxies[1])]);
    expect(result).toMatchObject([{ accessToken: "new-one", refreshToken: "one", providerSpecificData: { resourceUrl: "one.example" } }, { accessToken: "new-two", refreshToken: "two", providerSpecificData: { resourceUrl: "two.example" } }]);
    expect(proxyAwareFetch.mock.calls.map((call) => call[2])).toEqual(proxies);
    expect(await refreshQwenToken("bad")).toBeNull();
  });


  it("requests a device code using the real CLI service and PKCE challenge", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ device_code: "device", expires_in: 60 }));
    vi.stubGlobal("fetch", fetch);
    const service = new QwenService();
    expect(await service.requestDeviceCode("challenge")).toMatchObject({ device_code: "device" });
    expect(Object.fromEntries(fetch.mock.calls[0][1].body)).toMatchObject({ client_id: qwen.oauth.clientId, code_challenge: "challenge", code_challenge_method: "S256", scope: qwen.oauth.scope });
  });

  it("hides malformed device responses and transport errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("synthetic-secret", { status: 200 })).mockRejectedValueOnce(new Error("synthetic-secret"));
    vi.stubGlobal("fetch", fetch);
    const service = new QwenService();
    await expect(service.requestDeviceCode("challenge")).rejects.toThrow(/^Qwen device authorization failed$/);
    await expect(service.requestDeviceCode("challenge")).rejects.toThrow(/^Qwen device authorization failed$/);
  });

  it("aborts an in-flight poll at the expiry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true })));
    vi.stubGlobal("fetch", fetch);
    const promise = new QwenService().pollForToken("device", "verifier", 1, { expiresIn: 3 });
    const assertion = expect(promise).rejects.toThrow("Authorization timeout");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unavailable legacy CLI import before network access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const service = new QwenService();
    await expect(service.connect()).rejects.toThrow("Qwen CLI token import is unavailable");
    await expect(service.saveTokens()).rejects.toThrow("Qwen CLI token import is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors pending and slow_down intervals and stops after success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: "authorization_pending" }, 400)).mockResolvedValueOnce(json({ error: "slow_down" }, 400)).mockResolvedValueOnce(json({ access_token: "synthetic" }));
    vi.stubGlobal("fetch", fetch);
    const promise = new QwenService().pollForToken("device", "verifier", 2, { expiresIn: 30 });
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(6999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ access_token: "synthetic" });
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([["expired_token", "Device code expired"], ["access_denied", "Access denied"], ["secret-body", "Qwen token request failed"]])("handles %s safely", async (error, message) => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error, error_description: "synthetic-secret" }, 400)));
    const promise = new QwenService().pollForToken("device", "verifier", 1, { expiresIn: 10 });
    const assertion = expect(promise).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("cancels polling and stops at device expiry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(json({ error: "authorization_pending" }, 400));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const cancelled = new QwenService().pollForToken("device", "verifier", 2, { expiresIn: 10, signal: controller.signal });
    const cancelledAssertion = expect(cancelled).rejects.toThrow("Authorization cancelled");
    controller.abort();
    await cancelledAssertion;
    const expired = new QwenService().pollForToken("device", "verifier", 2, { expiresIn: 3 });
    const expiredAssertion = expect(expired).rejects.toThrow("Authorization timeout");
    await vi.advanceTimersByTimeAsync(3000);
    await expiredAssertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

});

describe("staged provider registration", () => {
  it("is wired into the existing OAuth provider table without touching Qwen Cloud keys", () => {
    const providers = fs.readFileSync(new URL("../../src/lib/oauth/providers.js", import.meta.url), "utf8");
    expect(providers).toContain('import { createQwenProviderHandlers } from "./providerParity/qwen/index.js";');
    expect(providers).toContain("qwen: createQwenProviderHandlers(QWEN_CONFIG),");
    expect(providers).not.toMatch(/["']?qwc["']?\s*:\s*createQwenProviderHandlers/);
  });

  it("redacts upstream errors while preserving recognized polling states", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: "secret-body" }, 400)).mockResolvedValueOnce(json({ error: "slow_down", error_description: "secret-body" }, 400));
    vi.stubGlobal("fetch", fetch);
    const handler = createQwenProviderHandlers(qwen.oauth);
    await expect(handler.requestDeviceCode(handler.config, "challenge")).rejects.toThrow("Qwen device authorization failed");
    expect(await handler.pollToken(handler.config, "device", "verifier")).toEqual({ ok: false, data: { error: "slow_down" } });
  });
});
