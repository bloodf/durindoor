import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const dashboardSessionMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getSettings: dashboardSessionMocks.getSettings,
  getSettingsSync: vi.fn(() => ({})),
}));

describe("apiKey.js CRC check goes through timingSafeCompare", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.API_KEY_SECRET;
  });

  it("accepts a key whose CRC matches and rejects a tampered CRC", async () => {
    process.env.API_KEY_SECRET = "test-secret-for-crc";
    vi.resetModules();
    const { generateApiKeyWithMachine, parseApiKey } = await import("../../src/shared/utils/apiKey.js");

    const { key } = generateApiKeyWithMachine("machine1234567890");
    expect(parseApiKey(key)).toMatchObject({ isNewFormat: true });

    const tampered = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");
    expect(parseApiKey(tampered)).toBeNull();
  });

  it("still accepts legacy sk-<8 hex> keys with no CRC", async () => {
    vi.resetModules();
    const { parseApiKey } = await import("../../src/shared/utils/apiKey.js");
    expect(parseApiKey("sk-abcd1234")).toEqual({ machineId: null, keyId: "abcd1234", isNewFormat: false });
  });
});

describe("dashboardSession.verifyDashboardPassword fallback compare", () => {
  beforeEach(() => {
    dashboardSessionMocks.getSettings.mockReset();
    delete process.env.INITIAL_PASSWORD;
  });

  it("accepts the correct initial password when no hash is stored", async () => {
    dashboardSessionMocks.getSettings.mockResolvedValue({ password: null });
    process.env.INITIAL_PASSWORD = "correct-horse-battery";
    const { verifyDashboardPassword } = await import("../../src/lib/auth/dashboardSession.js");
    expect(await verifyDashboardPassword("correct-horse-battery")).toBe(true);
  });

  it("rejects a wrong password when no hash is stored", async () => {
    dashboardSessionMocks.getSettings.mockResolvedValue({ password: null });
    process.env.INITIAL_PASSWORD = "correct-horse-battery";
    const { verifyDashboardPassword } = await import("../../src/lib/auth/dashboardSession.js");
    expect(await verifyDashboardPassword("wrong-guess")).toBe(false);
  });
});

describe("flowStore claim/state checks go through timingSafeCompare", () => {
  it("rejects a mismatched claim token and accepts a matching one", async () => {
    vi.resetModules();
    const { createOAuthFlow, claimOAuthFlow, isOAuthFlowClaimActive, consumeOAuthFlow } = await import(
      "../../src/lib/oauth/flowStore.js"
    );

    const created = createOAuthFlow({
      provider: "test-provider",
      kind: "authorization",
      state: "state-123",
      payload: { foo: "bar" },
    });
    const claim = claimOAuthFlow({ flowId: created.flowId, state: "state-123" });

    expect(isOAuthFlowClaimActive({ flowId: claim.flowId, claimToken: claim.claimToken })).toBe(true);
    expect(isOAuthFlowClaimActive({ flowId: claim.flowId, claimToken: "wrong-token" })).toBe(false);
    expect(consumeOAuthFlow({ flowId: claim.flowId, claimToken: "wrong-token" })).toBe(false);
    expect(consumeOAuthFlow({ flowId: claim.flowId, claimToken: claim.claimToken })).toBe(true);
  });

  it("rejects a mismatched state on lookup and accepts a matching one", async () => {
    vi.resetModules();
    const { createOAuthFlow, getOAuthFlow } = await import("../../src/lib/oauth/flowStore.js");

    const created = createOAuthFlow({
      provider: "test-provider-2",
      kind: "authorization",
      state: "state-456",
      payload: { foo: "bar" },
    });

    expect(getOAuthFlow({ flowId: created.flowId, state: "state-456" })).not.toBeNull();
    expect(getOAuthFlow({ flowId: created.flowId, state: "wrong-state" })).toBeNull();
  });
});
