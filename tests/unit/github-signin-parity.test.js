import { afterEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { GITHUB_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub device sign-in", () => {
  it("requests approval and keeps OAuth and Copilot credentials distinct", async () => {
    const fetch = vi.fn(async (url, options) => {
      if (url === GITHUB_CONFIG.deviceCodeUrl) return Response.json({ device_code: "device", user_code: "user", verification_uri: "https://github.com/login/device", interval: 5 });
      if (url === GITHUB_CONFIG.tokenUrl) return Response.json({ access_token: "github-token" });
      if (url === GITHUB_CONFIG.copilotTokenUrl) {
        expect(options.headers.Authorization).toBe("Bearer github-token");
        return Response.json({ token: "copilot-token", expires_at: 1900000000 });
      }
      if (url === GITHUB_CONFIG.userInfoUrl) return Response.json({ id: 42, login: "test-user" });
      throw new Error(`Unexpected outbound URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const device = await requestDeviceCode("github");
    expect(device.user_code).toBe("user");
    expect(fetch.mock.calls[0][1].body.get("client_id")).toBe(GITHUB_CONFIG.clientId);
    const result = await pollForToken("github", device.device_code);
    expect(fetch.mock.calls[1][1].body.get("device_code")).toBe("device");
    expect(result.tokens).toMatchObject({ accessToken: "github-token", providerSpecificData: { copilotToken: "copilot-token", copilotTokenExpiresAt: 1900000000, githubUserId: 42 } });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(["authorization_pending", "slow_down", "access_denied"])("does not exchange a %s poll", async (error) => {
    const fetch = vi.fn(async (url) => {
      expect(url).toBe(GITHUB_CONFIG.tokenUrl);
      return Response.json({ error });
    });
    vi.stubGlobal("fetch", fetch);
    expect(await pollForToken("github", "device")).toMatchObject({ success: false, error });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an invalid response error for a non-JSON poll body", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      expect(url).toBe(GITHUB_CONFIG.tokenUrl);
      return new Response("upstream unavailable", { status: 502 });
    }));
    // register-auth-02 decodes polls with decodeCopilotPollResponse, which
    // keeps the protocol error and drops the untrusted upstream text.
    const result = await pollForToken("github", "device");
    expect(result).toMatchObject({ success: false, error: "invalid_response" });
    expect(JSON.stringify(result)).not.toContain("upstream unavailable");
  });

  it("refreshes missing and nearly expired scoped tokens", () => {
    const executor = new GithubExecutor();
    expect(executor.needsRefresh({ accessToken: "github-token" })).toBe(true);
    expect(executor.needsRefresh({ copilotToken: "copilot-token", copilotTokenExpiresAt: Math.floor(Date.now() / 1000) + 60 })).toBe(true);
  });
});
