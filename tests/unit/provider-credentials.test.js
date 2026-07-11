import { describe, expect, it, vi } from "vitest";
import { refreshAndUpdateCredentials } from "../../src/shared/services/providerCredentials.js";
import { providerRefreshContext } from "../../src/shared/utils/providerCredentialContext.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function connection(overrides = {}) {
  return {
    id: "conn-1",
    provider: "github",
    updatedAt: "2025-12-31T23:59:00.000Z",
    apiKey: "top-api-original",
    accessToken: "access-original",
    refreshToken: "refresh-original",
    idToken: "id-original",
    expiresAt: "2026-01-01T01:00:00.000Z",
    providerSpecificData: {
      accountId: "account-original",
      copilotToken: "copilot-original",
      keep: "unchanged",
      apiKey: "nested-api-original",
      api_key: "nested-api-underscore-original",
    },
    ...overrides,
  };
}

function dependencies(executor) {
  return {
    getExecutorImpl: vi.fn(() => executor),
    getProviderConnectionByIdImpl: vi.fn().mockResolvedValue(connection()),
    updateProviderConnectionImpl: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reconcileDelays: [0],
  };
}

describe("provider credential refresh service", () => {
  it("returns the original connection without a write when refresh is unnecessary", async () => {
    const executor = { needsRefresh: vi.fn(() => false), refreshCredentials: vi.fn() };
    const deps = dependencies(executor);
    const original = connection();

    const result = await refreshAndUpdateCredentials(original, false, { strictProxy: true }, deps);

    expect(result).toEqual({ connection: original, refreshed: false });
    expect(executor.refreshCredentials).not.toHaveBeenCalled();
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("passes the full legacy credential contract and proxy policy to the executor", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "access-new", expiresIn: 60 }),
    };
    const deps = dependencies(executor);
    const original = connection({ lastRefreshAt: "2025-12-31T23:00:00.000Z" });
    const proxyOptions = { strictProxy: true, connectionProxyUrl: "http://proxy.invalid" };

    const result = await refreshAndUpdateCredentials(original, false, proxyOptions, deps);

    expect(executor.needsRefresh).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "access-original",
      refreshToken: "refresh-original",
      idToken: "id-original",
      connectionId: "conn-1",
      copilotToken: "copilot-original",
    }));
    expect(executor.refreshCredentials).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ info: expect.any(Function), warn: expect.any(Function), error: expect.any(Function) }),
      proxyOptions,
    );
    expect(deps.updateProviderConnectionImpl).toHaveBeenCalledWith("conn-1", {
      accessToken: "access-new",
      expiresAt: "2026-01-01T00:01:00.000Z",
      expiresIn: 60,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, {
      expectedRefreshContext: providerRefreshContext(original),
      returnCommitResult: true,
    });
    expect(result.connection).toMatchObject({
      accessToken: "access-new",
      refreshToken: "refresh-original",
      idToken: "id-original",
    });
  });

  it("preserves all stored secret bytes unless the provider explicitly replaces them", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({
        accessToken: "access-original",
        refreshToken: null,
        idToken: undefined,
        providerSpecificData: {
          profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test",
          apiKey: "nested-api-rewritten",
          api_key: "nested-api-underscore-rewritten",
        },
        copilotTokenExpiresAt: "2026-01-02T00:00:00.000Z",
      }),
    };
    const deps = dependencies(executor);
    const original = connection();

    const result = await refreshAndUpdateCredentials(original, false, null, deps);

    const update = deps.updateProviderConnectionImpl.mock.calls[0][1];
    expect(update.accessToken).toBe("access-original");
    expect(update).not.toHaveProperty("refreshToken");
    expect(update).not.toHaveProperty("idToken");
    expect(update.providerSpecificData).toEqual({
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test",
      copilotTokenExpiresAt: "2026-01-02T00:00:00.000Z",
    });
    expect(result.connection).toMatchObject({
      accessToken: "access-original",
      refreshToken: "refresh-original",
      idToken: "id-original",
      apiKey: "top-api-original",
    });
  });

  it("force refresh bypasses needsRefresh", async () => {
    const executor = {
      needsRefresh: vi.fn(() => false),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "forced" }),
    };
    const deps = dependencies(executor);

    await refreshAndUpdateCredentials(connection(), true, null, deps);

    expect(executor.needsRefresh).not.toHaveBeenCalled();
    expect(executor.refreshCredentials).toHaveBeenCalledTimes(1);
  });

  it("falls back to a still-present access token, but fails closed without one", async () => {
    const executor = { needsRefresh: vi.fn(() => true), refreshCredentials: vi.fn().mockResolvedValue(null) };
    const deps = dependencies(executor);
    const original = connection();

    await expect(refreshAndUpdateCredentials(original, false, null, deps)).resolves.toEqual({
      connection: original,
      refreshed: false,
    });
    await expect(refreshAndUpdateCredentials(connection({ accessToken: null }), false, null, deps))
      .rejects.toThrow("Please re-authorize");
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("redacts arbitrary hostile executor log bodies", async () => {
    const canary = "opaquecredentialcanary987654321";
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async (_credentials, log) => {
        log.error("TOKEN", `upstream body ${canary}`);
        return null;
      }),
    };
    const deps = dependencies(executor);

    await refreshAndUpdateCredentials(connection(), false, null, deps);

    expect(deps.log.error).toHaveBeenCalled();
    expect(JSON.stringify(deps.log.error.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(deps.log.error.mock.calls)).toContain("[redacted]");
  });

  it("captures CAS context before a hostile executor mutates its credential argument", async () => {
    const original = connection({
      provider: "kiro",
      providerSpecificData: {
        authMethod: "external_idp",
        client_id: "client-before",
        token_endpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        scopes: ["scope.before", "offline_access"],
      },
    });
    const before = structuredClone(original);
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async (credentials) => {
        credentials.providerSpecificData.client_id = "client-mutated";
        credentials.providerSpecificData.scopes.push("scope.mutated");
        return { accessToken: "access-new" };
      }),
    };
    const deps = dependencies(executor);

    await refreshAndUpdateCredentials(original, false, null, deps);

    expect(original).toEqual(before);
    expect(deps.updateProviderConnectionImpl).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ accessToken: "access-new" }),
      {
        expectedRefreshContext: providerRefreshContext(before),
        returnCommitResult: true,
      },
    );
  });

  it("does no work for a pre-aborted caller", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(),
    };
    const deps = dependencies(executor);
    const controller = new AbortController();
    controller.abort();

    await expect(refreshAndUpdateCredentials(connection(), false, null, {
      ...deps,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(executor.refreshCredentials).not.toHaveBeenCalled();
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("detaches cancelled or superseded callers but durably writes an issued rotation", async () => {
    let resolveRefresh;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; })),
    };
    const deps = dependencies(executor);
    const controller = new AbortController();
    const pending = refreshAndUpdateCredentials(connection(), false, null, { ...deps, signal: controller.signal });
    await vi.waitFor(() => expect(executor.refreshCredentials).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveRefresh({ accessToken: "late-token", refreshToken: "rotated-after-abort" });
    await vi.waitFor(() => expect(deps.updateProviderConnectionImpl).toHaveBeenCalledTimes(1));
    expect(deps.updateProviderConnectionImpl.mock.calls[0][1]).toMatchObject({
      accessToken: "late-token",
      refreshToken: "rotated-after-abort",
    });

    const current = { value: true };
    const secondExecutor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => {
        current.value = false;
        return { accessToken: "superseded-token" };
      }),
    };
    const secondDeps = dependencies(secondExecutor);
    await expect(refreshAndUpdateCredentials(connection(), false, null, {
      ...secondDeps,
      shouldCommit: () => current.value,
    })).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_REFRESH_SUPERSEDED" });
    expect(secondDeps.updateProviderConnectionImpl).toHaveBeenCalledTimes(1);
  });

  it("coordinates concurrent force and normal refresh callers by connection", async () => {
    let resolveRefresh;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; })),
    };
    const deps = dependencies(executor);
    deps.updateProviderConnectionImpl.mockResolvedValue({
      applied: true,
      connection: connection({ accessToken: "shared-new", refreshToken: "shared-rotated" }),
    });

    const first = refreshAndUpdateCredentials(connection(), false, null, deps);
    await vi.waitFor(() => expect(executor.refreshCredentials).toHaveBeenCalledTimes(1));
    const second = refreshAndUpdateCredentials(connection(), true, null, deps);
    resolveRefresh({ accessToken: "shared-new", refreshToken: "shared-rotated" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ refreshed: true, connection: expect.objectContaining({ accessToken: "shared-new" }) }),
      expect.objectContaining({ refreshed: true, connection: expect.objectContaining({ accessToken: "shared-new" }) }),
    ]);
    expect(executor.refreshCredentials).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnectionImpl).toHaveBeenCalledTimes(1);
  });

  it("times out detached callers without duplicating or abandoning the issued rotation", async () => {
    let resolveRefresh;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; })),
    };
    const deps = dependencies(executor);
    const options = { ...deps, callerTimeoutMs: 5 };

    await expect(refreshAndUpdateCredentials(connection(), false, null, options)).rejects.toMatchObject({
      name: "TimeoutError",
      code: "PROVIDER_CREDENTIAL_REFRESH_TIMEOUT",
    });
    await expect(refreshAndUpdateCredentials(connection(), true, null, options)).rejects.toMatchObject({
      name: "TimeoutError",
      code: "PROVIDER_CREDENTIAL_REFRESH_TIMEOUT",
    });
    expect(executor.refreshCredentials).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();

    resolveRefresh({ accessToken: "late-access", refreshToken: "late-refresh" });
    await vi.waitFor(() => expect(deps.updateProviderConnectionImpl).toHaveBeenCalledTimes(1));
    expect(deps.updateProviderConnectionImpl.mock.calls[0][1]).toMatchObject({
      accessToken: "late-access",
      refreshToken: "late-refresh",
    });
  });

  it.each(["invalid_grant", "unrecoverable_refresh_error"])(
    "fails closed without a write for %s",
    async (errorCode) => {
      const executor = {
        needsRefresh: vi.fn(() => true),
        refreshCredentials: vi.fn().mockResolvedValue({ error: errorCode, code: "provider-detail" }),
      };
      const deps = dependencies(executor);

      await expect(refreshAndUpdateCredentials(connection(), false, null, deps)).rejects.toMatchObject({
        code: "PROVIDER_REAUTH_REQUIRED",
        message: "Failed to refresh credentials. Please re-authorize the connection.",
      });
      expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
    },
  );

  it("recovers the repository credential winner after a concurrent invalid_grant", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ error: "invalid_grant" }),
    };
    const deps = dependencies(executor);
    const winner = connection({ accessToken: "winner-access", refreshToken: "winner-refresh" });
    deps.getProviderConnectionByIdImpl
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(winner);

    await expect(refreshAndUpdateCredentials(connection(), false, null, {
      ...deps,
      reconcileDelays: [0, 0],
    })).resolves.toEqual({ connection: winner, refreshed: false });
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("reconciles an invalid_grant when a supported issuer alias changed concurrently", async () => {
    const original = connection({
      provider: "kiro",
      providerSpecificData: {
        authMethod: "external_idp",
        client_id: "client-original",
        token_endpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        scopes: ["scope.original"],
      },
    });
    const winner = connection({
      provider: "kiro",
      providerSpecificData: {
        ...original.providerSpecificData,
        token_endpoint: "https://login.microsoftonline.com/new-tenant/oauth2/v2.0/token",
      },
    });
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ error: "invalid_grant" }),
    };
    const deps = dependencies(executor);
    deps.getProviderConnectionByIdImpl.mockResolvedValue(winner);

    await expect(refreshAndUpdateCredentials(original, false, null, deps)).resolves.toEqual({
      connection: winner,
      refreshed: false,
    });
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("does not write an unrecognized refresh result", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ error: "temporary_provider_failure", detail: "opaque" }),
    };
    const deps = dependencies(executor);
    const original = connection();

    await expect(refreshAndUpdateCredentials(original, false, null, deps)).resolves.toEqual({
      connection: original,
      refreshed: false,
    });
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["object access token", { accessToken: { value: "new" } }],
    ["array refresh token", { accessToken: "access-new", refreshToken: ["refresh-new"] }],
    ["numeric Copilot token", { accessToken: "access-new", copilotToken: 123 }],
    ["object client ID", { accessToken: "access-new", providerSpecificData: { clientId: { value: "client" } } }],
    ["insecure token endpoint", { accessToken: "access-new", providerSpecificData: { tokenEndpoint: "http://login.example/token" } }],
    ["invalid expiry", { accessToken: "access-new", expiresIn: { seconds: 60 } }],
    ["boolean expiry", { accessToken: "access-new", expiresIn: true }],
    ["array expiry", { accessToken: "access-new", expiresIn: [3600] }],
    ["missing access token", { refreshToken: "refresh-rotated", expiresIn: 3600 }],
    ["huge absolute expiry", { accessToken: "access-new", expiresAt: 1e300 }],
    ["huge relative expiry", { accessToken: "access-new", expiresIn: 1e300 }],
    ["huge Copilot expiry", { accessToken: "access-new", copilotTokenExpiresAt: 1e300 }],
  ])("rejects a mixed refresh patch containing a malformed %s without a partial write", async (_label, refreshResult) => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue(refreshResult),
    };
    const deps = dependencies(executor);

    await expect(refreshAndUpdateCredentials(connection(), false, null, deps)).rejects.toMatchObject({
      code: "PROVIDER_REFRESH_RESULT_MALFORMED",
    });
    expect(deps.updateProviderConnectionImpl).not.toHaveBeenCalled();
  });

  it("uses the current credential winner when compare-and-swap rejects a stale rotation", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "losing-access", refreshToken: "losing-refresh" }),
    };
    const deps = dependencies(executor);
    const winner = connection({ accessToken: "winner-access", refreshToken: "winner-refresh" });
    deps.updateProviderConnectionImpl.mockResolvedValue({ applied: false, connection: winner });

    await expect(refreshAndUpdateCredentials(connection(), false, null, deps)).resolves.toEqual({
      connection: winner,
      refreshed: false,
    });
  });

  it("reports deletion during the atomic write without mutating the input", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "new-token" }),
    };
    const deps = dependencies(executor);
    deps.updateProviderConnectionImpl.mockResolvedValue(null);
    const original = connection();
    const before = structuredClone(original);

    await expect(refreshAndUpdateCredentials(original, false, null, deps)).rejects.toMatchObject({
      code: "PROVIDER_CONNECTION_NOT_FOUND",
    });
    expect(original).toEqual(before);
  });

  it("propagates database rejection without mutating the input object", async () => {
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "new-token" }),
    };
    const deps = dependencies(executor);
    deps.updateProviderConnectionImpl.mockRejectedValue(new Error("database unavailable"));
    const original = connection();
    const before = structuredClone(original);

    await expect(refreshAndUpdateCredentials(original, false, null, deps)).rejects.toThrow("database unavailable");
    expect(original).toEqual(before);
  });
});
