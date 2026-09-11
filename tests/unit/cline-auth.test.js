import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { refreshAndUpdateCredentials } from "../../src/shared/services/providerCredentials.js";

const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJjbGluZSJ9.signature";

function refreshedResponse(accessToken = jwt) {
  return new Response(JSON.stringify({
    data: {
      accessToken,
      refreshToken: "rotated-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("ClinePass authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends opaque API keys unchanged and prefixes OAuth JWTs only on the wire", () => {
    const executor = new DefaultExecutor("clinepass");

    expect(executor.buildHeaders({ apiKey: "clp_opaque-api-key" }, true).Authorization)
      .toBe("Bearer clp_opaque-api-key");
    expect(executor.buildHeaders({ accessToken: jwt }, true).Authorization)
      .toBe(`Bearer workos:${jwt}`);
    expect(executor.buildHeaders({ accessToken: `workos:${jwt}` }, true).Authorization)
      .toBe(`Bearer workos:${jwt}`);
  });


  it("refreshes ClinePass through Cline endpoints without rewriting the returned token", async () => {
    const proxyOptions = { connectionProxyUrl: "http://proxy.example.test:8080" };
    mocks.proxyAwareFetch.mockResolvedValue(refreshedResponse());

    const result = await refreshTokenByProvider(
      "clinepass",
      { refreshToken: "original-refresh" },
      null,
      proxyOptions,
    );

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.cline.bot/api/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          refreshToken: "original-refresh",
          grantType: "refresh_token",
          clientType: "extension",
        }),
      }),
      proxyOptions,
    );
    expect(result).toMatchObject({ accessToken: jwt, refreshToken: "rotated-refresh" });
    expect(new DefaultExecutor("clinepass").buildHeaders(result, true).Authorization)
      .toBe(`Bearer workos:${jwt}`);
  });

  it("rejects refresh responses without a usable access token", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response(
      JSON.stringify({ data: {} }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(refreshTokenByProvider(
      "clinepass",
      { refreshToken: "malformed-refresh" },
      null,
    )).resolves.toBeNull();
  });

  it("persists refreshed JWT bytes unchanged", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(refreshedResponse());
    const updateProviderConnectionImpl = vi.fn(async (_id, update) => ({
      applied: true,
      connection: update,
    }));
    const connection = {
      id: "clinepass-connection",
      provider: "clinepass",
      authType: "oauth",
      accessToken: "old-access",
      refreshToken: "persistence-refresh",
      expiresAt: new Date(0).toISOString(),
      providerSpecificData: {},
    };

    await refreshAndUpdateCredentials(connection, true, null, {
      getExecutorImpl: () => new DefaultExecutor("clinepass"),
      updateProviderConnectionImpl,
      now: () => Date.now(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(updateProviderConnectionImpl).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({ accessToken: jwt, refreshToken: "rotated-refresh" }),
      expect.any(Object),
    );
    expect(updateProviderConnectionImpl.mock.calls[0][1].accessToken).not.toContain("workos:");
  });
});
