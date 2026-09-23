import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import {
  normalizeGheUrl,
  resolveGheCopilotApiBase,
} from "../../open-sse/config/gheCopilot.js";
import { refreshGheCopilotCredentials } from "../../open-sse/services/gheCopilotAuth.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import gheCopilot from "../../src/lib/oauth/gheCopilotProvider.js";
import { toGheOrigin } from "../../src/shared/components/GheCopilotAuthModal.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("GHE URL helpers", () => {
  it("accepts https origins only", () => {
    expect(normalizeGheUrl(" https://ghe.acme.com/some/path/ ")).toBe("https://ghe.acme.com");
    expect(normalizeGheUrl("http://ghe.acme.com")).toBeNull();
    expect(normalizeGheUrl("https://user:pw@ghe.acme.com")).toBeNull();
    expect(normalizeGheUrl("not a url")).toBeNull();
    expect(normalizeGheUrl(undefined)).toBeNull();
    expect(toGheOrigin("https://ghe.acme.com/x")).toBe("https://ghe.acme.com");
    expect(toGheOrigin("ftp://ghe.acme.com")).toBeNull();
  });

  it("prefers endpoints.api, then endpoints.proxy, then the GHE host", () => {
    expect(resolveGheCopilotApiBase({
      copilotApiUrl: "https://copilot-api.acme.ghe.com/",
      copilotProxyUrl: "https://proxy.acme.ghe.com",
      gheUrl: "https://acme.ghe.com",
    })).toBe("https://copilot-api.acme.ghe.com");
    expect(resolveGheCopilotApiBase({ copilotProxyUrl: "https://proxy.acme.ghe.com/chat/completions" }))
      .toBe("https://proxy.acme.ghe.com");
    expect(resolveGheCopilotApiBase({ gheUrl: "https://acme.ghe.com" })).toBe("https://acme.ghe.com");
    expect(resolveGheCopilotApiBase({ copilotApiUrl: "http://evil.test", gheUrl: "https://acme.ghe.com" }))
      .toBe("https://acme.ghe.com");
    expect(resolveGheCopilotApiBase({})).toBeNull();
  });
});

describe("GheCopilotExecutor", () => {
  const credentials = {
    copilotToken: "cp-token",
    providerSpecificData: { gheUrl: "https://acme.ghe.com", copilotApiUrl: "https://copilot-api.acme.ghe.com" },
  };

  it("is registered for ghe-copilot", () => {
    expect(getExecutor("ghe-copilot")).toBeInstanceOf(GheCopilotExecutor);
  });

  it("routes every Copilot endpoint to the connection's API host", () => {
    const executor = new GheCopilotExecutor();
    expect(executor.buildUrl("gpt-5.4", true, 0, credentials))
      .toBe("https://copilot-api.acme.ghe.com/chat/completions");
    expect(executor.endpointUrl("messagesUrl", credentials))
      .toBe("https://copilot-api.acme.ghe.com/v1/messages");
    expect(executor.endpointUrl("responsesUrl", credentials))
      .toBe("https://copilot-api.acme.ghe.com/responses");
  });

  it("refuses to fall back to github.com when the connection has no host", () => {
    const executor = new GheCopilotExecutor();
    expect(() => executor.buildUrl("gpt-5.4", true, 0, { providerSpecificData: {} }))
      .toThrow(/enterprise URL/);
  });

  it("leaves github.com Copilot on the static registry URLs", () => {
    expect(getExecutor("github").buildUrl("gpt-5.4", true, 0, credentials))
      .toBe("https://api.githubcopilot.com/chat/completions");
  });
});

describe("refreshGheCopilotCredentials", () => {
  beforeEach(() => fetchMock.mockReset());

  it("mints a Copilot token on the enterprise host and records endpoints.api", async () => {
    fetchMock.mockResolvedValueOnce(json({
      token: "cp-new",
      expires_at: 1900000000,
      endpoints: { api: "https://copilot-api.acme.ghe.com", proxy: "https://proxy.acme.ghe.com" },
    }));
    const result = await refreshGheCopilotCredentials({
      accessToken: "gho_access",
      refreshToken: "ghr_refresh",
      providerSpecificData: { gheUrl: "https://acme.ghe.com" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://acme.ghe.com/api/v3/copilot_internal/v2/token");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("token gho_access");
    expect(result).toEqual({
      accessToken: "gho_access",
      refreshToken: "ghr_refresh",
      copilotToken: "cp-new",
      copilotTokenExpiresAt: 1900000000,
      providerSpecificData: {
        copilotApiUrl: "https://copilot-api.acme.ghe.com",
        copilotProxyUrl: "https://proxy.acme.ghe.com",
      },
    });
  });

  it("refreshes the OAuth token on the enterprise host when the Copilot mint fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ message: "Bad credentials" }, 401))
      .mockResolvedValueOnce(json({ access_token: "gho_new", refresh_token: "ghr_new", expires_in: 28800 }))
      .mockResolvedValueOnce(json({ token: "cp-new", expires_at: 1900000000 }));
    const result = await refreshGheCopilotCredentials({
      accessToken: "gho_old",
      refreshToken: "ghr_old",
      providerSpecificData: { gheUrl: "https://acme.ghe.com" },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://acme.ghe.com/login/oauth/access_token");
    expect(String(fetchMock.mock.calls[1][1].body)).toContain("grant_type=refresh_token");
    expect(result).toMatchObject({
      accessToken: "gho_new",
      refreshToken: "ghr_new",
      copilotToken: "cp-new",
    });
  });

  it("does nothing without a valid https gheUrl", async () => {
    const result = await refreshGheCopilotCredentials({
      accessToken: "gho", providerSpecificData: { gheUrl: "http://acme.ghe.com" },
    });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is the ghe-copilot proactive refresh handler", async () => {
    fetchMock.mockResolvedValueOnce(json({ token: "cp", expires_at: 1900000000 }));
    const result = await refreshTokenByProvider("ghe-copilot", {
      accessToken: "gho",
      refreshToken: "ghr",
      providerSpecificData: { gheUrl: "https://acme.ghe.com" },
    }, null);
    expect(result?.copilotToken).toBe("cp");
    expect(fetchMock.mock.calls[0][0]).toBe("https://acme.ghe.com/api/v3/copilot_internal/v2/token");
  });
});

describe("GHE Copilot OAuth adapter", () => {
  const originalFetch = globalThis.fetch;
  const webFetch = vi.fn();
  beforeEach(() => {
    webFetch.mockReset();
    globalThis.fetch = webFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests the device code on the enterprise host and keeps the host private", async () => {
    webFetch.mockResolvedValueOnce(json({ device_code: "dev", user_code: "AB-CD", expires_in: 900 }));
    const data = await gheCopilot.requestDeviceCode(gheCopilot.config, undefined, { gheUrl: "https://acme.ghe.com" });
    expect(webFetch.mock.calls[0][0]).toBe("https://acme.ghe.com/login/device/code");
    expect(data).toMatchObject({ device_code: "dev", _gheUrl: "https://acme.ghe.com" });
  });

  it("rejects a non-https host before any request", async () => {
    await expect(gheCopilot.requestDeviceCode(gheCopilot.config, undefined, { gheUrl: "http://acme" }))
      .rejects.toThrow(/https/);
    expect(webFetch).not.toHaveBeenCalled();
  });

  it("polls, mints, and maps the enterprise identity and API host", async () => {
    webFetch.mockResolvedValueOnce(json({ access_token: "gho_x", refresh_token: "ghr_x" }));
    const poll = await gheCopilot.pollToken(gheCopilot.config, "dev", null, { _gheUrl: "https://acme.ghe.com" });
    expect(webFetch.mock.calls[0][0]).toBe("https://acme.ghe.com/login/oauth/access_token");
    expect(poll.ok).toBe(true);

    webFetch
      .mockResolvedValueOnce(json({ token: "cp", expires_at: 1900000000, endpoints: { api: "https://copilot-api.acme.ghe.com" } }))
      .mockResolvedValueOnce(json({ id: 7, login: "octo", name: "Octo Cat", email: "octo@acme.com" }));
    const extra = await gheCopilot.postExchange(poll.data, null, { _gheUrl: "https://acme.ghe.com" });
    const urls = webFetch.mock.calls.slice(1).map((call) => call[0]).sort();
    expect(urls).toEqual([
      "https://acme.ghe.com/api/v3/copilot_internal/v2/token",
      "https://acme.ghe.com/api/v3/user",
    ]);
    const tokens = gheCopilot.mapTokens(poll.data, extra);
    expect(tokens).toMatchObject({
      accessToken: "gho_x",
      refreshToken: "ghr_x",
      name: "octo",
      email: "octo@acme.com",
      providerSpecificData: {
        gheUrl: "https://acme.ghe.com",
        copilotApiUrl: "https://copilot-api.acme.ghe.com",
        copilotToken: "cp",
        githubLogin: "octo",
      },
    });
  });
});
