import { afterEach, describe, expect, it, vi } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";
import { getProvider } from "../../src/lib/oauth/providers.js";
import { normalizeKiroExternalIdpAuth } from "../../src/lib/oauth/kiroExternalIdp.js";
import { buildKiroIdentityHeaders } from "../../open-sse/shared/kiroHeaders.js";
import { buildKiroRegistration } from "../../src/lib/oauth/providerParity/kiro/index.js";
import registration from "../../src/lib/oauth/providerParity/kiro/registration.json";

const service = new KiroService();
const profileArn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/synthetic";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function transport(handler) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("Kiro production service contracts (closed network)", () => {
  it.each(["builder-id", "idc"])("registers and exchanges %s with the same regional client and egress", async (authMethod) => {
    const provider = getProvider("kiro");
    const proxy = { connectionProxyUrl: "http://account-a.invalid:8080", strictProxy: true };
    const calls = transport(async (url, init) => {
      expect(init.proxyOptions).toBe(proxy);
      const body = JSON.parse(init.body);
      if (url.endsWith("/client/register")) {
        expect(body.issuerUrl).toBe(authMethod === "idc" ? undefined : provider.config.issuerUrl);
        return Response.json({ clientId: "synthetic-client", clientSecret: "synthetic-secret" });
      }
      expect(body.clientId).toBe("synthetic-client");
      expect(body.clientSecret).toBe("synthetic-secret");
      if (url.endsWith("/device_authorization")) return Response.json({ deviceCode: "synthetic-device", userCode: "ABCD", expiresIn: 600 });
      expect(url).toBe("https://oidc.eu-central-1.amazonaws.com/token");
      expect(body.deviceCode).toBe("synthetic-device");
      return Response.json({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600 });
    });
    const device = await provider.requestDeviceCode(provider.config, null, { authMethod, region: "eu-central-1", startUrl: "https://tenant.awsapps.com/start" }, proxy);
    const tokens = await provider.pollToken(provider.config, device.device_code, null, device, proxy);
    expect(tokens.ok).toBe(true);
    expect(tokens.data.access_token).toBe("synthetic-access");
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("uses PKCE code exchange once without retrying an accepted malformed response", async () => {
    const calls = transport(async () => Response.json({ refreshToken: "synthetic" }));
    const url = new URL(service.buildSocialLoginUrl("google", "challenge", "state"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state");
    await expect(service.exchangeSocialCode("code", "verifier")).rejects.toThrow("Invalid Kiro token response");
    expect(JSON.parse(calls.mock.calls[0][1].body)).toEqual({ code: "code", code_verifier: "verifier", redirect_uri: url.searchParams.get("redirect_uri") });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it.each(["authorization_pending", "slow_down", "expired_token", "access_denied"])("classifies device %s without resubmitting", async (error) => {
    const calls = transport(async () => Response.json({ error, error_description: "SENSITIVE-UPSTREAM" }, { status: 400 }));
    const result = await service.pollDeviceToken("client", "secret", "device");
    expect(result.pending).toBe(["authorization_pending", "slow_down"].includes(error));
    expect(JSON.stringify(result)).not.toContain("SENSITIVE-UPSTREAM");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("supports social device create and one pending poll with isolated routing", async () => {
    const proxy = { connectionProxyUrl: "http://social.invalid" };
    const calls = transport(async (url, init) => {
      expect(init.proxyOptions).toBe(proxy);
      if (url.endsWith("authorization")) {
        expect(JSON.parse(init.body)).toEqual({ clientId: "kiro-cli", loginProvider: "Github" });
        return Response.json({ deviceCode: "synthetic-device", verificationUriComplete: "https://example.invalid/verify" });
      }
      return Response.json({ error: "slow_down" }, { status: 400 });
    });
    await service.startSocialDevice("github", proxy);
    expect(await service.pollSocialDevice("synthetic-device", proxy)).toEqual({ pending: true, error: "slow_down" });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("keeps two concurrent refresh clients, tokens, proxies and request identities separate", async () => {
    const accounts = ["a", "b"].map((id) => ({ id, clientId: `client-${id}`, clientSecret: `secret-${id}`, proxy: { connectionProxyUrl: `http://${id}.invalid` } }));
    const calls = transport(async (url, init) => {
      const body = JSON.parse(init.body);
      const account = accounts.find((a) => a.clientId === body.clientId);
      expect(init.proxyOptions).toBe(account.proxy);
      expect(body.clientSecret).toBe(account.clientSecret);
      expect(body.refreshToken).toBe(`refresh-${account.id}`);
      return Response.json({ accessToken: `access-${account.id}`, refreshToken: `rotated-${account.id}`, expiresIn: 3600 });
    });
    const results = await Promise.all(accounts.map((a) => service.refreshToken(`refresh-${a.id}`, { ...a, authMethod: "idc", region: "eu-central-1" }, a.proxy)));
    expect(results.map((r) => r.accessToken)).toEqual(["access-a", "access-b"]);
    expect(calls).toHaveBeenCalledTimes(2);
    const identity = (a, token) => buildKiroIdentityHeaders({ accessToken: token, providerSpecificData: { clientId: a.clientId } });
    expect(identity(accounts[0], "old")).toEqual(identity(accounts[0], "new"));
    expect(identity(accounts[0], "old")).not.toEqual(identity(accounts[1], "old"));
  });

  it("imports external IdP identity and refreshes against its Microsoft endpoint only", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const credential = normalizeKiroExternalIdpAuth({ auth_method: "external_idp", access_token: "synthetic-access", refresh_token: "synthetic-refresh", client_id: "synthetic-client", scopes: ["offline_access"], token_endpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token", profile_arn: profileArn, region: "eu-central-1", expires_in: 60 });
    expect(credential.expiresAt).toBe("2026-01-01T00:01:00.000Z");
    const calls = transport(async (url, init) => {
      expect(url).toBe(credential.providerSpecificData.tokenEndpoint);
      expect(init.body.get("client_id")).toBe("synthetic-client");
      return Response.json({ access_token: "synthetic-new", expires_in: 60 });
    });
    expect(await service.refreshToken(credential.refreshToken, credential.providerSpecificData)).toMatchObject({ accessToken: "synthetic-new", refreshToken: "synthetic-refresh", providerSpecificData: { profileArn } });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("fails unsupported modes, endpoint decorations and invalid regions before network", async () => {
    const calls = transport(() => { throw new Error("unexpected network"); });
    await expect(service.startSocialDevice("unknown")).rejects.toThrow("Unsupported");
    expect(() => service.buildSocialLoginUrl("unknown", "c", "s")).toThrow("Unsupported");
    await expect(service.refreshToken("synthetic", { authMethod: "api_key" })).rejects.toThrow("Unsupported");
    await expect(service.refreshToken("synthetic", { authMethod: "idc" })).rejects.toThrow("registration");
    await expect(service.registerClient("us-east-1.attacker.invalid")).rejects.toThrow();
    await expect(service.refreshToken("synthetic", { authMethod: "external_idp", tokenEndpoint: "https://user:password@login.microsoftonline.com/tenant/token" })).rejects.toThrow();
    expect(calls).not.toHaveBeenCalled();
  });

  it("sanitizes rejected tokens and transport failures without retries", async () => {
    const calls = transport(async () => new Response("SENSITIVE-UPSTREAM", { status: 401 }));
    await expect(service.refreshToken("aorAAAAAGsynthetic")).rejects.toThrow(/^Token refresh failed$/);
    calls.mockRejectedValue(new Error("SENSITIVE-UPSTREAM synthetic-token"));
    await expect(service.exchangeSocialCode("synthetic", "synthetic")).rejects.toThrow(/^Kiro request failed$/);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("bounds a blocked request with a fake-clock abort and never retries", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const calls = transport((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("synthetic transport secret")), { once: true });
    }));
    const result = expect(service.exchangeSocialCode("code", "verifier")).rejects.toThrow(/^Kiro request failed$/);
    setTimeout(() => controller.abort(), 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(calls).toHaveBeenCalledTimes(1);
    timeout.mockRestore();
  });

  it("rejects malformed JSON without reflecting the response", async () => {
    transport(async () => new Response("SENSITIVE-UPSTREAM"));
    await expect(service.exchangeSocialCode("code", "verifier")).rejects.toThrow(/^Invalid Kiro response$/);
  });

  it("validates imported social tokens without adopting an unrelated client", async () => {
    const calls = transport(async (url) => {
      expect(url).toContain("/refreshToken");
      return Response.json({ accessToken: "synthetic-access", profileArn, expiresIn: 60 });
    });
    expect(await service.validateImportToken("aorAAAAAGsynthetic")).toMatchObject({ authMethod: "imported", profileArn });
    await service.refreshToken("aorAAAAAGsynthetic", { authMethod: "imported", clientId: "unrelated", clientSecret: "unrelated" });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("pins API-key probing and optional profile discovery to the selected proxy", async () => {
    const proxy = { connectionProxyUrl: "http://api-key.invalid" };
    const calls = transport(async (url, init) => {
      expect(init.proxyOptions).toBe(proxy);
      if (url.includes("ListAvailableModels")) {
        expect(url).toBe("https://q.eu-central-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR");
        expect(init.headers.tokentype).toBe("API_KEY");
        return Response.json({ models: [] });
      }
      return Response.json({ profiles: [{ arn: profileArn }] });
    });
    expect(await service.validateApiKey("synthetic-key", "eu-central-1", proxy)).toMatchObject({ authMethod: "api_key", region: "eu-central-1", profileArn });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("uses the selected proxy for model discovery and preserves catalog fields", async () => {
    const proxy = { connectionProxyUrl: "http://catalog.invalid" };
    transport(async (_url, init) => {
      expect(init.proxyOptions).toBe(proxy);
      expect(JSON.parse(init.body).profileArn).toBe(profileArn);
      return Response.json({ models: [{ modelId: "synthetic-model", tokenLimits: { maxInputTokens: 123 } }] });
    });
    expect(await service.listAvailableModels("synthetic", profileArn, proxy)).toMatchObject([{ id: "synthetic-model", maxInputTokens: 123 }]);
  });
});

// Isolated staging assertions: remove this block when the ordered auth batch registers the helper.
describe("Kiro staged registration", () => {
  it("documents its sole integration slot and preserves the IDC issuer distinction", () => {
    expect(registration.status).toBe("staged");
    expect(Object.keys(registration.exports)).toEqual(["buildKiroRegistration"]);
    const config = getProvider("kiro").config;
    expect(buildKiroRegistration(config, "builder-id").issuerUrl).toBe(config.issuerUrl);
    expect(buildKiroRegistration(config, "idc")).not.toHaveProperty("issuerUrl");
    expect(() => buildKiroRegistration(config, "external_idp")).toThrow("Unsupported");
  });
});
