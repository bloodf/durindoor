import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";
import iflow from "../../open-sse/providers/registry/iflow.js";

afterEach(() => vi.unstubAllGlobals());

describe("retained iFlow behavior after upstream removal", () => {
  it("builds the dashboard authorization URL with the callback and state", async () => {
    const auth = await generateAuthData("iflow", "http://localhost:1234/callback");
    const url = new URL(auth.authUrl);
    expect(url.origin + url.pathname).toBe(iflow.oauth.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      loginMethod: "phone", type: "phone", redirect: "http://localhost:1234/callback",
      state: auth.state, client_id: iflow.oauth.clientId,
    });
  });

  it("reports a failed dashboard token exchange without making another request", async () => {
    const fetch = vi.fn(async (url, options) => {
      expect(url).toBe(iflow.oauth.tokenUrl);
      expect(Object.fromEntries(options.body)).toMatchObject({ grant_type: "authorization_code", code: "fake-code" });
      return new Response("denied", { status: 400 });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens("iflow", "fake-code", "http://localhost:1234/callback"))
      .rejects.toThrow("denied");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit stream usage option", () => {
    const body = { messages: [], stream_options: { include_usage: false } };
    expect(new IFlowExecutor().transformRequest("qwen3-max", body, true, {})).toEqual(body);
    expect(body.stream_options.include_usage).toBe(false);
  });
});
