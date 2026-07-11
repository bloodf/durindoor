import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  getProjectIdForConnection,
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
});
