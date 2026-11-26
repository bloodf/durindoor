import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";
import { validateSettingsPatch } from "../../src/lib/settings/settingsSchema.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  recordProviderRateLimitEvidence: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: mocks.recordProviderRateLimitEvidence,
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth/accountErrors.js");

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const PROSE = "Individual quota reached. Resets in 76h25m43s.";

const evidenceFor = (options) => parseRateLimitEvidence({ status: 429, now: NOW, ...options });

async function lockMs(errorText, context = {}) {
  const result = await markAccountUnavailable("conn-1", 429, errorText, "openai", "gpt-4o", null, context);
  return result.cooldownMs;
}

describe("OmniRoute #20457 - relative quota countdowns get their own ceiling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getProviderConnections.mockResolvedValue([{ id: "conn-1", provider: "openai" }]);
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
  });
  afterEach(() => vi.useRealTimers());

  it("marks only the compact countdown as relative prose", () => {
    expect(evidenceFor({ bodyText: PROSE })).toMatchObject({ source: "quota_text", relativeCountdown: true });
    expect(evidenceFor({ bodyText: "Your quota will reset after 1h2m3s" }).relativeCountdown).toBe(true);
    expect(evidenceFor({ bodyText: "Quota exceeded; reset in 14 days" }).relativeCountdown).toBeUndefined();
    expect(evidenceFor({ bodyText: "Quota reached. Resets at 2027-01-16 02:00:00" }).relativeCountdown).toBeUndefined();
    expect(evidenceFor({ bodyText: PROSE, headers: new Headers({ "retry-after": "270000" }) }).relativeCountdown).toBeUndefined();
  });

  it("caps a 76 hour countdown at 6 hours by default", async () => {
    expect(await lockMs("Rate limit exceeded", { rateLimitEvidence: evidenceFor({ bodyText: PROSE }) })).toBe(6 * HOUR);
    expect(await lockMs(PROSE)).toBe(6 * HOUR);
  });

  it("honors the operator ceiling", async () => {
    mocks.getSettings.mockResolvedValue({ quotaProseMaxCooldownMs: 24 * HOUR });
    expect(await lockMs(PROSE)).toBe(24 * HOUR);
  });

  it("keeps a countdown below the ceiling, and a header reset above it", async () => {
    expect(await lockMs("Individual quota reached. Resets in 1h2m3s.")).toBe(HOUR + 123_000);
    const header = evidenceFor({ bodyText: PROSE, headers: new Headers({ "retry-after": "270000" }) });
    expect(await lockMs("Rate limit exceeded", { rateLimitEvidence: header })).toBe(270_000_000);
  });

  it("keeps the default when the settings read fails", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db down"));
    expect(await lockMs(PROSE)).toBe(6 * HOUR);
  });

  it("validates the setting between 1 minute and 24 hours", () => {
    expect(validateSettingsPatch({ quotaProseMaxCooldownMs: 6 * HOUR })).toEqual([]);
    for (const bad of [59_999, 24 * HOUR + 1, 60_000.5, "3600000"]) {
      expect(validateSettingsPatch({ quotaProseMaxCooldownMs: bad })).toEqual(["quotaProseMaxCooldownMs"]);
    }
  });
});
