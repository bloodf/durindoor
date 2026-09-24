import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { MUSE_CODE_MINT_URL, MUSE_CODE_USER_AGENT } from "../../open-sse/config/museCode.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { MuseCodeExecutor } from "../../open-sse/executors/muse-code.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import museCode from "../../src/lib/oauth/museCodeProvider.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("muse-code registry", () => {
  it("speaks the Responses wire with the Muse CLI user agent and both auth modes", () => {
    expect(PROVIDERS["muse-code"]).toMatchObject({
      baseUrl: "https://api.meta.ai/v1/responses",
      format: "openai-responses",
      clientId: "1031625952748946",
    });
    expect(PROVIDERS["muse-code"].headers["User-Agent"]).toMatch(/^muse-build\//);
  });
});

describe("MuseCodeExecutor", () => {
  beforeEach(() => fetchMock.mockReset());

  it("is registered for muse-code", () => {
    expect(getExecutor("muse-code")).toBeInstanceOf(MuseCodeExecutor);
  });

  it("sends the minted key or a pasted key as a bearer to /v1/responses", () => {
    const executor = new MuseCodeExecutor();
    expect(executor.buildUrl("muse-spark-1.3", true, 0, {})).toBe("https://api.meta.ai/v1/responses");
    const oauth = executor.buildHeaders({ accessToken: "mk-live" }, true);
    expect(oauth.Authorization).toBe("Bearer mk-live");
    expect(oauth["User-Agent"]).toMatch(/^muse-build\//);
    expect(executor.buildHeaders({ apiKey: "META_KEY" }, true).Authorization).toBe("Bearer META_KEY");
  });

  it("remints before the first request when only the dca token is stored", () => {
    const executor = new MuseCodeExecutor();
    expect(executor.needsRefresh({ accessToken: "dca:abc", refreshToken: "dca:abc" })).toBe(true);
    expect(executor.needsRefresh({ accessToken: "mk-live", refreshToken: "dca:abc" })).toBe(false);
    expect(executor.needsRefresh({ apiKey: "META_KEY" })).toBe(false);
  });

  it("remints the inference key from the dca token", async () => {
    fetchMock.mockResolvedValueOnce(json({ api_key: "mk-new", subs_tier_name: "Pro", is_subs_active: true }));
    const result = await new MuseCodeExecutor().refreshCredentials({
      accessToken: "mk-old",
      refreshToken: "dca:abc",
      providerSpecificData: { dcaToken: "dca:abc" },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(MUSE_CODE_MINT_URL);
    expect(init.headers.Authorization).toBe("Bearer dca:abc");
    expect(init.headers["User-Agent"]).toBe(MUSE_CODE_USER_AGENT);
    expect(JSON.parse(init.body)).toEqual({ dca_token: "dca:abc" });
    expect(result).toMatchObject({
      accessToken: "mk-new",
      refreshToken: "dca:abc",
      providerSpecificData: { dcaToken: "dca:abc", subsTierName: "Pro", isSubsActive: true },
    });
  });

  it("never remints a pasted API key connection", async () => {
    const result = await new MuseCodeExecutor().refreshCredentials({ apiKey: "META_KEY" });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the mint is rejected", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 401));
    await expect(refreshTokenByProvider("muse-code", { refreshToken: "dca:abc" }, null)).resolves.toBeNull();
  });
});

describe("Muse Code device login adapter", () => {
  const originalFetch = globalThis.fetch;
  const webFetch = vi.fn();
  beforeEach(() => {
    webFetch.mockReset();
    fetchMock.mockReset();
    globalThis.fetch = webFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests a device code with the public client id and Muse user agent", async () => {
    webFetch.mockResolvedValueOnce(json({
      device_code: "dev", user_code: "ABCD", verification_uri: "https://auth.meta.com/device", expires_in: 600,
    }));
    const data = await museCode.requestDeviceCode(museCode.config);
    const [url, init] = webFetch.mock.calls[0];
    expect(url).toBe("https://auth.meta.com/oidc/device/authorization/");
    expect(String(init.body)).toBe("client_id=1031625952748946");
    expect(init.headers["User-Agent"]).toBe(MUSE_CODE_USER_AGENT);
    expect(data).toMatchObject({ device_code: "dev", user_code: "ABCD", interval: 5 });
  });

  it("rejects a device response without an expiry", async () => {
    webFetch.mockResolvedValueOnce(json({ device_code: "dev", user_code: "ABCD" }));
    await expect(museCode.requestDeviceCode(museCode.config)).rejects.toThrow(/expiry/);
  });

  it("polls the device token endpoint", async () => {
    webFetch.mockResolvedValueOnce(json({ error: "authorization_pending" }, 400));
    const poll = await museCode.pollToken(museCode.config, "dev");
    expect(webFetch.mock.calls[0][0]).toBe("https://auth.meta.com/oidc/device/token/");
    expect(String(webFetch.mock.calls[0][1].body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
    expect(poll).toEqual({ ok: false, data: { error: "authorization_pending" } });
  });

  it("stores the minted key and keeps the dca token as the durable credential", async () => {
    fetchMock.mockResolvedValueOnce(json({ api_key: "mk-live", user_email: "dev@meta.test", user_full_name: "Dev" }));
    const tokens = { access_token: "dca:abc", expires_in: 3600 };
    const mapped = museCode.mapTokens(tokens, await museCode.postExchange(tokens));
    expect(mapped).toMatchObject({
      accessToken: "mk-live",
      refreshToken: "dca:abc",
      expiresIn: undefined,
      email: "dev@meta.test",
      displayName: "Dev",
      providerSpecificData: { authKind: "oauth", dcaToken: "dca:abc" },
    });
  });

  it("still saves a dca-only login when the mint fails", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    const tokens = { access_token: "dca:abc", expires_in: 3600 };
    const mapped = museCode.mapTokens(tokens, await museCode.postExchange(tokens));
    expect(mapped).toMatchObject({ accessToken: "dca:abc", refreshToken: "dca:abc", expiresIn: 3600 });
  });
});
