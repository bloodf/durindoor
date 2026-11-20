import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { getAccessToken } from "../../open-sse/services/tokenRefresh.js";
import { getCodeBuddyCnUsage } from "../../open-sse/services/usage/codebuddy-cn.js";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(), proxyAwareFetch: (url, options) => globalThis.fetch(url, options),
}));
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url) => { throw new Error(`Unexpected outbound request: ${url}`); })));
afterEach(() => vi.unstubAllGlobals());

describe("CodeBuddy CN connection contract", () => {
  it("starts and polls the CN sign-in flow with the issued state", async () => {
    fetch.mockImplementation(async (url, options) => {
      const parsed = new URL(url);
      expect(parsed.host).toBe("copilot.tencent.com");
      if (parsed.pathname.endsWith("/state")) {
        expect(options.method).toBe("POST");
        expect(parsed.searchParams.get("platform")).toBe("CLI");
        expect(JSON.parse(options.body)).toEqual({ platform: "CLI" });
        return reply({ code: 0, data: { state: "fake-state", url: "https://example.test/login" } });
      }
      expect(parsed.pathname).toBe("/v2/plugin/auth/token");
      expect(options.method).toBe("GET");
      expect(parsed.searchParams.get("state")).toBe("fake-state");
      return reply({ code: 0, data: { accessToken: "fake-access", refreshToken: "fake-refresh", expiresIn: 3600 } });
    });
    const start = await requestDeviceCode("codebuddy-cn");
    expect(start.device_code).toBe("fake-state");
    expect(start.verification_uri).toBe("https://example.test/login");
    expect(await pollForToken("codebuddy-cn", start.device_code)).toMatchObject({ success: true, tokens: { accessToken: "fake-access", refreshToken: "fake-refresh" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes each connection using its own refresh token", async () => {
    fetch.mockImplementation(async (url, options) => {
      expect(url).toBe("https://copilot.tencent.com/v2/plugin/auth/token/refresh");
      expect(options.method).toBe("POST");
      return reply({ code: 0, data: { accessToken: `access-${options.headers["X-Refresh-Token"]}` } });
    });
    const [a, b] = await Promise.all(["fake-one", "fake-two"].map((refreshToken) => getAccessToken("codebuddy-cn", { refreshToken })));
    expect(a).toMatchObject({ accessToken: "access-fake-one", refreshToken: "fake-one" });
    expect(b).toMatchObject({ accessToken: "access-fake-two", refreshToken: "fake-two" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([{ accessToken: "fake-oauth" }, { apiKey: "fake-key" }])("sends the selected credential and forces streaming: %o", async (credentials) => {
    fetch.mockResolvedValue(reply({ error: { message: "provider error" } }, 400));
    const result = await new CodeBuddyExecutor().execute({ model: "glm-5.2", body: { messages: [{ role: "user", content: "hello" }] }, stream: false, credentials });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://copilot.tencent.com/v2/chat/completions");
    expect(options.headers.Authorization).toBe(`Bearer ${credentials.accessToken || credentials.apiKey}`);
    expect(JSON.parse(options.body).stream).toBe(true);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ error: { message: "provider error" } });
  });

  it("preserves provider usage errors for API-key connections", async () => {
    fetch.mockResolvedValue(reply({ code: 123, msg: "quota unavailable" }));
    expect(await getCodeBuddyCnUsage(null, "fake-key")).toEqual({ message: "CodeBuddy CN quota error: quota unavailable" });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer fake-key");
  });
});
