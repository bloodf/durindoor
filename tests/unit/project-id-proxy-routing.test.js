import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshProviderCredentials: vi.fn(),
  updateProviderConnection: vi.fn(async () => true),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshProviderCredentials: mocks.refreshProviderCredentials,
  shouldRefreshCredentials: vi.fn(() => true),
}));

vi.mock("../../src/lib/localDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  updateProviderConnection: mocks.updateProviderConnection,
}));

import {
  getProjectIdForConnection,
  removeConnection,
  stopCacheCleanup,
} from "../../open-sse/services/projectId.js";
import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";

function projectResponse(projectId) {
  return {
    ok: true,
    json: async () => ({ cloudaicompanionProject: projectId }),
  };
}

describe("project-id proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeConnection("connection-direct");
    removeConnection("connection-strict");
    removeConnection("connection-shared");
    removeConnection("connection-redaction");
    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "rotated-access",
      expiresIn: 3600,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    stopCacheCleanup();
  });

  it("stops after terminal onboarding returns no project ID", async () => {
    vi.useFakeTimers();
    try {
      mocks.proxyAwareFetch.mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        return new Response(JSON.stringify("tierId" in body
          ? { done: true, response: { cloudaicompanionProject: {} } }
          : { allowedTiers: [{ id: "standard-tier", isDefault: true }] }), { status: 200 });
      });

      const pending = getProjectIdForConnection(
        "connection-direct",
        "access-direct",
        { disableEnvProxy: true },
        null,
        "gemini-cli",
      );
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toBeNull();
      expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a stored project ID when the access token rotates", async () => {
    await checkAndRefreshToken("antigravity", {
      connectionId: "connection-direct",
      accessToken: "old-access",
      refreshToken: "refresh-token",
      projectId: "stored-project",
    }, { disableEnvProxy: true }, { force: true });

    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).toHaveBeenCalledOnce();
  });

  it("discovers a missing project ID through the refreshed credential route", async () => {
    const route = { disableEnvProxy: true, strictProxy: false };
    mocks.proxyAwareFetch.mockResolvedValue(projectResponse("discovered-project"));

    await checkAndRefreshToken("antigravity", {
      connectionId: "connection-direct",
      accessToken: "old-access",
      refreshToken: "refresh-token",
    }, route, { force: true });

    await vi.waitFor(() => expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(2));
    expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce();
    expect(mocks.proxyAwareFetch.mock.calls[0][2]).toEqual(expect.objectContaining(route));
    expect(mocks.proxyAwareFetch.mock.calls[0][1].headers).not.toHaveProperty("X-Goog-Api-Client");
    expect(mocks.updateProviderConnection).toHaveBeenLastCalledWith(
      "connection-direct",
      { projectId: "discovered-project" },
    );
  });

  it("uses the exact route for project discovery after refresh", async () => {
    const direct = { disableEnvProxy: true, strictProxy: false };
    const strict = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example.test:8080",
      disableEnvProxy: true,
      strictProxy: true,
    };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(projectResponse("project-direct"))
      .mockResolvedValueOnce(projectResponse("project-strict"));

    await expect(getProjectIdForConnection(
      "connection-direct",
      "access-direct",
      direct,
    )).resolves.toBe("project-direct");
    await expect(getProjectIdForConnection(
      "connection-strict",
      "access-strict",
      strict,
    )).resolves.toBe("project-strict");

    expect(mocks.proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      direct,
    );
    expect(mocks.proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      strict,
    );
  });

  it("does not coalesce in-flight discovery across routing policies", async () => {
    const direct = { disableEnvProxy: true, strictProxy: false };
    const strict = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example.test:8080",
      disableEnvProxy: true,
      strictProxy: true,
    };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(projectResponse("project-direct"))
      .mockResolvedValueOnce(projectResponse("project-strict"));

    const results = await Promise.all([
      getProjectIdForConnection("connection-shared", "same-access", direct),
      getProjectIdForConnection("connection-shared", "same-access", strict),
    ]);

    expect(results).toEqual(["project-direct", "project-strict"]);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("redacts upstream OAuth and proxy secrets from routing diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({
        refresh_token: "project-refresh-secret",
        detail: "http://alice:proxy-secret@proxy.example.test:8080?token=query-secret",
      }),
    });

    await expect(getProjectIdForConnection(
      "connection-redaction",
      "access-token",
      { disableEnvProxy: true },
    )).resolves.toBeNull();

    const warning = warn.mock.calls.flat().join(" ");
    expect(warning).toContain("[redacted]");
    expect(warning).not.toContain("project-refresh-secret");
    expect(warning).not.toContain("proxy-secret");
    expect(warning).not.toContain("query-secret");
  });

  it("aborts project discovery when its last subscriber disconnects", async () => {
    const controller = new AbortController();
    let upstreamSignal;
    mocks.proxyAwareFetch.mockImplementation((_url, options) => {
      upstreamSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    });

    const pending = getProjectIdForConnection(
      "connection-direct",
      "access-direct",
      { disableEnvProxy: true },
      controller.signal,
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(upstreamSignal.aborted).toBe(true);
  });

  it("cancels a stalled loadCodeAssist response body", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.proxyAwareFetch.mockResolvedValue(new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel,
    }), { status: 200 }));

    const pending = getProjectIdForConnection(
      "connection-direct",
      "access-direct",
      { disableEnvProxy: true },
      controller.signal,
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("rejects an oversized loadCodeAssist response without caching it", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response(
      JSON.stringify({ cloudaicompanionProject: `project-${"x".repeat(260 * 1024)}` }),
      { status: 200 },
    ));

    await expect(getProjectIdForConnection(
      "connection-direct",
      "access-direct",
      { disableEnvProxy: true },
    )).resolves.toBeNull();
    await expect(getProjectIdForConnection(
      "connection-direct",
      "access-direct",
      { disableEnvProxy: true },
    )).resolves.toBeNull();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("starts fresh discovery after the previous last subscriber aborts", async () => {
    const controller = new AbortController();
    let resolveOld;
    let resolveFresh;
    mocks.proxyAwareFetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));

    const abandoned = getProjectIdForConnection(
      "connection-shared",
      "access-shared",
      { disableEnvProxy: true },
      controller.signal,
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });

    const fresh = getProjectIdForConnection(
      "connection-shared",
      "access-shared",
      { disableEnvProxy: true },
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2));
    resolveOld(projectResponse("project-old"));
    await Promise.resolve();
    const coalesced = getProjectIdForConnection(
      "connection-shared",
      "access-shared",
      { disableEnvProxy: true },
    );
    resolveFresh(projectResponse("project-fresh"));
    await expect(Promise.all([fresh, coalesced])).resolves.toEqual(["project-fresh", "project-fresh"]);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("stops onboarding after request cancellation", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ allowedTiers: [{ id: "default", isDefault: true }] }),
      })
      .mockResolvedValueOnce(new Response(new ReadableStream({
        pull: () => new Promise(() => {}),
        cancel,
      }), { status: 200 }));

    const pending = getProjectIdForConnection(
      "connection-strict",
      "access-strict",
      { strictProxy: true },
      controller.signal,
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce or cache project discovery after connection removal", async () => {
    let resolveOld;
    let resolveFresh;
    mocks.proxyAwareFetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));

    const oldRequest = getProjectIdForConnection(
      "connection-shared",
      "token-old",
      { disableEnvProxy: true },
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce());
    removeConnection("connection-shared");
    const freshRequest = getProjectIdForConnection(
      "connection-shared",
      "token-new",
      { disableEnvProxy: true },
    );
    await vi.waitFor(() => expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2));

    resolveOld(projectResponse("project-old"));
    resolveFresh(projectResponse("project-fresh"));
    await expect(oldRequest).resolves.toBeNull();
    await expect(freshRequest).resolves.toBe("project-fresh");

    await expect(getProjectIdForConnection(
      "connection-shared",
      "token-new",
      { disableEnvProxy: true },
    )).resolves.toBe("project-fresh");
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});
