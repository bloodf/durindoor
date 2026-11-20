import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOM_PROMPT_CHARS } from "../../src/shared/constants/customPrompt.js";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), privileged: false }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/settings/settingsPatchAuth", () => ({
  AUTH_CRITICAL_SETTING_KEYS: ["comboPrompts"], SECRET_SETTING_KEYS: [],
  canModifySecurityCriticalSettings: async () => mocks.privileged,
  stripSettingKeys: (body, keys) => keys.forEach((key) => delete body[key]),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => mocks.privileged }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));
const route = await import("../../src/app/api/settings/route.js");

describe("operator combo prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.privileged = true;
    mocks.getSettings.mockResolvedValue({ comboPrompts: { outer: "private" } });
    mocks.updateSettings.mockImplementation(async (patch) => ({ ...patch }));
  });
  it("persists an explicit map and returns it to an operator", async () => {
    const response = await route.PATCH({ json: async () => ({ comboPrompts: { outer: "instruction" } }) });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ comboPrompts: { outer: "instruction" } });
    expect(response.body.comboPrompts).toEqual({ outer: "instruction" });
  });
  it.each([null, [], { outer: 1 }, { outer: "x".repeat(MAX_CUSTOM_PROMPT_CHARS + 1) }])("rejects invalid maps", async (comboPrompts) => {
    const response = await route.PATCH({ json: async () => ({ comboPrompts }) });
    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
  it("neither reveals nor permits unprivileged changes", async () => {
    mocks.privileged = false;
    expect((await route.GET({})).body).not.toHaveProperty("comboPrompts");
    await route.PATCH({ json: async () => ({ comboPrompts: { outer: "changed" }, theme: "dark" }) });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ theme: "dark" });
  });
});
