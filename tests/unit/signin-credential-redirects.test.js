import { describe, expect, it, vi } from "vitest";
import { credentialFetch } from "../../open-sse/utils/credentialFetch.js";
import { devinDesktopOAuth } from "../../src/lib/oauth/services/devin-desktop.js";
import { requestMinimaxCodeDeviceCode, pollMinimaxCodeDeviceToken } from "../../open-sse/services/minimaxCodeAuth.js";
import workbuddy from "../../src/lib/oauth/workbuddyProvider.js";
import freebuff from "../../src/lib/oauth/freebuffProvider.js";

const redirect = (status, location) => new Response(null, { status, headers: { location } });
const success = () => Response.json({ token: "synthetic-token-with-sufficient-length" });

describe("credential-bearing sign-in redirects", () => {
  it.each([302, 307, 308])( "rejects Devin cross-origin %i without replaying the code or verifier", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(redirect(status, "https://attacker.invalid/collect"));
    await expect(devinDesktopOAuth.exchangeToken(devinDesktopOAuth.config, "synthetic-code", "http://localhost/cb", "synthetic-verifier", "state", null, null, fetcher)).rejects.toThrow("another origin");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", body: JSON.stringify({ code: "synthetic-code", code_verifier: "synthetic-verifier" }) });
  });

  it("follows a same-origin Devin exchange redirect", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect(307, "/auth/cli/final")).mockResolvedValueOnce(success());
    await expect(devinDesktopOAuth.exchangeToken(devinDesktopOAuth.config, "synthetic-code", "http://localhost/cb", "synthetic-verifier", null, null, null, fetcher)).resolves.toMatchObject({ authMethod: "browser" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([302, 307, 308])("rejects cross-origin redirects without another request (%i)", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(redirect(status, "https://attacker.invalid/collect"));
    await expect(credentialFetch(fetcher, "https://account.invalid/token", { method: "POST", body: "synthetic-credential" })).rejects.toMatchObject({ code: "cross_origin_redirect" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("continues only same-origin redirects and marks each request manual", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect(302, "/same-origin")).mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(credentialFetch(fetcher, "https://account.invalid/start", { method: "POST", body: "synthetic" })).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init.redirect)).toEqual(["manual", "manual"]);
  });

  it("marks MiniMax Code, WorkBuddy and Freebuff sign-in fetches manual", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("device/code")) return Response.json({ device_code: "synthetic-device", user_code: "ABCD" });
      if (String(url).includes("oauth2/token")) return Response.json({ error: "authorization_pending" }, { status: 400 });
      if (String(url).includes("/state")) return Response.json({ code: 0, data: { state: "synthetic-state", authUrl: "https://workbuddy.invalid/login" } });
      if (String(url).includes("/token?state")) return Response.json({ code: 11217 });
      if (String(url).includes("/api/auth/cli/code")) return Response.json({ loginUrl: "https://freebuff.invalid/login", fingerprintHash: "synthetic-hash", expiresAt: String(Date.now() + 60000) });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchImpl);
    await requestMinimaxCodeDeviceCode({ codeChallenge: "synthetic-challenge", fetchImpl });
    await pollMinimaxCodeDeviceToken({ deviceCode: "synthetic-device", codeVerifier: "synthetic-verifier", fetchImpl });
    await workbuddy.requestDeviceCode(undefined);
    await freebuff.requestDeviceCode({ codeUrl: "https://freebuff.invalid/api/auth/cli/code", statusUrl: "https://freebuff.invalid/status", loginTimeoutSec: 60, pollInterval: 5000 });
    expect(fetchImpl.mock.calls.filter(([, init]) => init).every(([, init]) => init.redirect === "manual")).toBe(true);
  });

  it.each([302, 307, 308])("rejects WorkBuddy refresh cross-origin %i without a second request", async (status) => {
    const { refreshWorkbuddyToken } = await import("../../open-sse/services/workbuddyAuth.js");
    const fetcher = vi.fn().mockResolvedValue(redirect(status, "https://attacker.invalid/collect"));
    await expect(refreshWorkbuddyToken({ refreshToken: "synthetic-refresh-token" }, null, null, fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});
