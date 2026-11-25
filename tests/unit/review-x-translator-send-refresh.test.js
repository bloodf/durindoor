import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/localDb.js", () => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(async ({ provider }) => [{ id: "fixture", provider, accessToken: "old", refreshToken: "old-refresh" }]),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("open-sse/index.js", () => ({ getExecutor: () => ({ execute: mock.execute }) }));
vi.mock("@/shared/services/providerCredentials.js", () => ({ refreshAndUpdateCredentials: mock.refresh }));

import { POST } from "../../src/app/api/translator/send/route.js";

beforeEach(() => {
  vi.clearAllMocks();
  mock.cancel.mockResolvedValue();
});

describe("translator send refresh failures", () => {
  it.each([
    ["antigravity", 401, "PROVIDER_REAUTH_REQUIRED", "invalid_grant"],
    ["agy", 403, "PROVIDER_REFRESH_TIMEOUT", "caller timeout"],
  ])("returns the upstream %s error after %s refresh fails", async (provider, status, code, message) => {
    const error = Object.assign(new Error(message), { code });
    mock.refresh.mockRejectedValue(error);
    mock.execute.mockResolvedValue({ response: { status, ok: false, body: { cancel: mock.cancel } } });

    const response = await POST(new Request("http://localhost/api/translator/send", {
      method: "POST", body: JSON.stringify({ provider, model: "fixture", body: { messages: [] } }),
    }));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ success: false, error: `Provider error: ${status}`, details: `Upstream provider returned HTTP ${status}` });
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
});
