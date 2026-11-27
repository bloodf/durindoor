import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import { refreshIflowToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";
import iflow from "../../open-sse/providers/registry/iflow.js";
import { getIflowUsage } from "../../open-sse/services/usage/misc.js";

const redirect = "http://localhost:1234/callback";
let restoreFetch;
afterEach(() => { restoreFetch?.(); restoreFetch = undefined; vi.unstubAllGlobals(); });

describe("retained iFlow contract", () => {
  it("builds the browser URL and exchanges a code for separate OAuth and API credentials", async () => {
    const auth = await generateAuthData("iflow", redirect);
    const url = new URL(auth.authUrl);
    expect(url.origin + url.pathname).toBe(iflow.oauth.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ redirect, state: auth.state, loginMethod: "phone", type: "phone", client_id: iflow.oauth.clientId });
    const fetch = vi.fn().mockImplementationOnce(async (target, options) => {
      expect(target).toBe(iflow.oauth.tokenUrl);
      expect(options.method).toBe("POST");
      expect(Object.fromEntries(options.body)).toMatchObject({ grant_type: "authorization_code", code: "fake-code", redirect_uri: redirect });
      return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 });
    }).mockImplementationOnce(async (target) => {
      expect(target).toBe(`${iflow.oauth.userInfoUrl}?accessToken=fake-access`);
      return Response.json({ success: true, data: { apiKey: "fake-key", email: "test@example.invalid" } });
    }).mockImplementation(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    const result = await exchangeTokens("iflow", "fake-code", redirect, null, auth.state);
    expect(result).toMatchObject({ accessToken: "fake-access", refreshToken: "fake-refresh", apiKey: "fake-key", email: "test@example.invalid" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsuccessful user-info lookup", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "fake-access" })).mockResolvedValueOnce(Response.json({ success: false, message: "denied" })).mockImplementation(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    // register-auth-02: profile failures report a fixed message, never the upstream text.
    const error = await exchangeTokens("iflow", "fake-code", redirect).catch((caught) => caught);
    expect(error.message).toBe("iFlow user info request failed");
    expect(error.message).not.toContain("denied");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes OAuth tokens without replacing the separately held API key", async () => {
    const fetch = vi.fn(async (target, options) => {
      expect(target).toBe(iflow.oauth.tokenUrl);
      expect(Object.fromEntries(options.body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "fake-refresh" });
      return Response.json({ access_token: "new-access", expires_in: 60 });
    });
    restoreFetch = __setOriginalFetchForTesting(fetch);
    expect(await refreshIflowToken("fake-refresh")).toEqual({ accessToken: "new-access", refreshToken: "fake-refresh", expiresIn: 60 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes a mocked chat stream and upstream quota error through the executor", async () => {
    const executor = new IFlowExecutor();
    const fetch = vi.fn().mockImplementationOnce(async (url, options) => {
      expect(url).toBe(iflow.transport.baseUrl);
      expect(options.headers.Authorization).toBe("Bearer fake-key");
      expect(JSON.parse(options.body)).toMatchObject({ model: "qwen3-max", stream_options: { include_usage: true } });
      return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }).mockImplementationOnce(async () => new Response("quota exceeded", { status: 429 })).mockImplementation(() => { throw new Error("Unexpected outbound request"); });
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const args = { model: "qwen3-max", body: { model: "qwen3-max", messages: [], stream: true }, stream: true, credentials: { apiKey: "fake-key", accessToken: "fake-access" }, requestPolicy: { maxTransportAttempts: 1 } };
    const success = await executor.execute(args);
    expect(await success.response.text()).toContain("data: [DONE]");
    const error = await executor.execute(args);
    expect(error.response.status).toBe(429);
    expect(await error.response.text()).toBe("quota exceeded");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retains the static model list, stream usage option and local-only quota message", async () => {
    const executor = new IFlowExecutor();
    expect(iflow.models.length).toBeGreaterThan(0);
    expect(executor.buildUrl()).toBe(iflow.transport.baseUrl);
    expect(executor.transformRequest("fake-model", { messages: [] }, true, {})).toEqual({ messages: [], stream_options: { include_usage: true } });
    expect(await getIflowUsage("fake-access")).toEqual({ message: "iFlow connected. Usage tracked per request." });
  });
});
