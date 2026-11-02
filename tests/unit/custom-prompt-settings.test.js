import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOM_PROMPT_CHARS } from "../../src/shared/constants/customPrompt.js";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));

const settingsRoute = await import("../../src/app/api/settings/route.js");

describe("settings API custom prompt validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockImplementation(async (patch) => ({ ...patch }));
    mocks.getSettings.mockResolvedValue({});
  });

  it.each([
    [{ customPromptEnabled: "yes" }, "Invalid customPromptEnabled"],
    [{ customPrompt: 42 }, "Invalid customPrompt"],
    [{ customPrompt: "x".repeat(MAX_CUSTOM_PROMPT_CHARS + 1) }, "Invalid customPrompt"],
  ])("rejects %j", async (patch, error) => {
    const response = await settingsRoute.PATCH({ json: async () => patch });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("persists a valid prompt", async () => {
    const response = await settingsRoute.PATCH({ json: async () => ({ customPromptEnabled: true, customPrompt: "be terse" }) });
    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ customPromptEnabled: true, customPrompt: "be terse" }));
  });
});

describe("settings API custom prompt read exposure", () => {
  it("hides the prompt text from non-operator reads", async () => {
    mocks.getSettings.mockResolvedValue({ customPromptEnabled: true, customPrompt: "secret instruction" });
    const response = await settingsRoute.GET({ headers: new Headers(), cookies: { get: () => undefined } });
    expect(response.body.customPromptEnabled).toBe(true);
    expect(response.body).not.toHaveProperty("customPrompt");
  });
});
