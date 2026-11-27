// MIT: contract compared with OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523,
// src/lib/oauth/providers/zed-hosted.ts and open-sse/shared/zedAuth.ts.
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zedHosted } from "../../src/lib/oauth/zedHostedProvider.js";
import { clearZedCaches, discoverZedHostedModels, fetchZedLlmToken } from "../../open-sse/shared/zedHostedAuth.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const account = (token, systemId) => ({ accessToken: token, providerSpecificData: { userId: "user", organizationId: "org", systemId, enableSessionDispatch: true } });
afterEach(() => { clearZedCaches(); vi.useRealTimers(); });

describe("Zed Hosted production contracts", () => {
  it("binds each native callback to its own private key and profile transport", async () => {
    const a = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:3000/callback");
    const b = zedHosted.buildAuthUrl(zedHosted.config, "http://127.0.0.1:3000/callback");
    const key = crypto.createPublicKey({ key: Buffer.from(new URL(a.authUrl).searchParams.get("native_app_public_key"), "base64url"), format: "der", type: "pkcs1" });
    const sealed = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from("synthetic-token-a"));
    const callback = `user_id=user-a&access_token=${sealed.toString("base64url")}`;
    const fetch = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe("user-a synthetic-token-a");
      expect(init.headers["x-zed-system-id"]).toBe(a.systemId);
      return json({ default_organization_id: "org-a" });
    });
    await expect(zedHosted.exchangeToken(zedHosted.config, callback, a.redirectUri, b.codeVerifier, null, { fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const mapped = zedHosted.mapTokens(await zedHosted.exchangeToken(zedHosted.config, callback, a.redirectUri, a.codeVerifier, null, { fetch, systemId: a.systemId }));
    expect(mapped).toMatchObject({ accessToken: "synthetic-token-a", providerSpecificData: { userId: "user-a", organizationId: "org-a", systemId: a.systemId } });
    expect(mapped.refreshToken).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("expires cached LLM credentials on the clock and isolates different account tokens", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url, init) => json({ token: `llm-${init.headers.Authorization}` }));
    const a = account("synthetic-a", "client-a");
    const b = account("synthetic-b", "client-b");
    const [first, second] = await Promise.all([fetchZedLlmToken(a, { fetch }), fetchZedLlmToken(b, { fetch })]);
    expect(first).not.toBe(second);
    expect(await fetchZedLlmToken(a, { fetch })).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(50 * 60 * 1000);
    await fetchZedLlmToken(a, { fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([, init]) => init.headers["x-zed-system-id"])).toEqual(["client-a", "client-b", "client-a"]);
  });

  it("refuses model discovery before network without explicit opt-in", async () => {
    const fetch = vi.fn();
    const credentials = account("synthetic-a", "client-a");
    credentials.providerSpecificData.enableSessionDispatch = false;
    await expect(discoverZedHostedModels(credentials, { fetch })).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
