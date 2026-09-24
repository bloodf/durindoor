/**
 * POST /v1/systemone honors x-connection-id (sent by the dashboard example for
 * the selected connection) strictly: only that connection may run, so a pinned
 * Laya request never reaches another connection's host or key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCreds: vi.fn(async () => ({ connectionId: "b", apiKey: "" })),
  core: vi.fn(async () => ({ success: true, response: new Response("{}", { status: 200 }) }))
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: mocks.getCreds,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null } }))
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: vi.fn(async () => ({ provider: "laya", model: "english" })) }));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsageForResponse: vi.fn((key, response) => response)
}));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: mocks.core }));

const { handleSystemone } = await import("../../src/sse/handlers/systemone.js");

const post = (headers = {}) => new Request("http://localhost/v1/systemone", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({ model: "laya/english", state: "refund", questions: { q: { type: "noul", instructions: "?" } } })
});

describe("System One connection pin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects only the pinned connection", async () => {
    await handleSystemone(post({ "x-connection-id": "b" }));
    expect(mocks.getCreds.mock.calls[0][3]).toMatchObject({ preferredConnectionId: "b", strictConnectionId: "b" });
  });

  it("leaves selection open without a pin", async () => {
    await handleSystemone(post());
    expect(mocks.getCreds.mock.calls[0][3].strictConnectionId).toBeUndefined();
  });
});
