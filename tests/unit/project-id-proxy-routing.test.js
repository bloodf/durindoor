import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
  stopCacheCleanup,
} from "../../open-sse/services/projectId.js";

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    stopCacheCleanup();
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

  it("does not coalesce or cache project discovery across token invalidation", async () => {
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
    invalidateProjectId("connection-shared");
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
