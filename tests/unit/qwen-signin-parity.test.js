import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";
import { getQwenUsage } from "../../open-sse/services/usage/misc.js";
import qwen from "../../open-sse/providers/registry/qwen.js";
import cloud from "../../open-sse/providers/registry/qwen-cloud.js";
import plan from "../../open-sse/providers/registry/qwen-cloud-token-plan.js";
import { refreshQwenToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("legacy Qwen OAuth contract", () => {
  it("starts PKCE device authorization and polls with the verifier", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ device_code: "device", expires_in: 600, interval: 5 }))
      .mockResolvedValueOnce(json({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(json({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600, resource_url: "portal.example.test" }));
    vi.stubGlobal("fetch", fetch);
    expect(await requestDeviceCode("qwen", "challenge")).toMatchObject({ expires_in: 600, interval: 5 });
    expect(Object.fromEntries(fetch.mock.calls[0][1].body)).toMatchObject({ code_challenge: "challenge", code_challenge_method: "S256", scope: qwen.oauth.scope });
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: false, error: "authorization_pending" });
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: true, tokens: { accessToken: "fake-access", refreshToken: "fake-refresh", expiresIn: 3600, providerSpecificData: { resourceUrl: "portal.example.test" } } });
    expect(Object.fromEntries(fetch.mock.calls[2][1].body)).toMatchObject({ device_code: "device", code_verifier: "verifier", grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  });

  it("returns expired and denied poll responses without inventing tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: "expired_token" }, 400)).mockResolvedValueOnce(json({ error: "access_denied" }, 400)));
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: false, error: "expired_token" });
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: false, error: "access_denied" });
  });

  it("retains a refresh token when the response does not rotate it", async () => {
    proxyAwareFetch.mockResolvedValueOnce(json({ access_token: "new-fake", expires_in: 3600, resource_url: "portal.example.test" }));
    expect(await refreshQwenToken("old-fake")).toMatchObject({ accessToken: "new-fake", refreshToken: "old-fake", expiresIn: 3600, providerSpecificData: { resourceUrl: "portal.example.test" } });
    expect(Object.fromEntries(proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-fake" });
  });

  it("keeps OAuth, cloud and token-plan catalogs and usage separate", async () => {
    expect([qwen.id, cloud.id, plan.id]).toEqual(["qwen", "qwen-cloud", "qwen-cloud-token-plan"]);
    expect(qwen.category).toBe("oauth");
    expect([cloud.authType, plan.authType]).toEqual(["apikey", "apikey"]);
    expect(cloud.transport.baseUrl).not.toBe(plan.transport.baseUrl);
    expect(qwen.models.map((model) => model.id)).toContain("coder-model");
    expect(await getQwenUsage("fake", {})).toEqual({ message: "Qwen connected. No resource URL available." });
    expect(await getQwenUsage("fake", { resourceUrl: "portal.example.test" })).toEqual({ message: "Qwen connected. Usage tracked per request." });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("builds the legacy request for stream=%s", (stream) => {
    const executor = new QwenExecutor();
    const credentials = { accessToken: "fake", providerSpecificData: { resourceUrl: "portal.example.test" } };
    expect(executor.buildUrl("coder-model", stream, 0, credentials)).toBe("https://portal.example.test/v1/chat/completions");
    expect(executor.buildHeaders(credentials, stream)).toMatchObject({ Authorization: "Bearer fake", Accept: stream ? "text/event-stream" : "application/json" });
    const body = executor.transformRequest("coder-model", { model: "coder-model", messages: [{ role: "user", content: "hello" }], stream }, stream, credentials);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "hello" });
    expect(body.stream_options).toEqual(stream ? { include_usage: true } : undefined);
  });
});
