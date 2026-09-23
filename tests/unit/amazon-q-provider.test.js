import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshKiroToken = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/tokenRefresh/providers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshKiroToken,
}));

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { isKiroFamilyProvider } from "../../open-sse/providers/models/kiroVariants.js";
import { getProvider } from "../../src/lib/oauth/providers.js";

describe("amazon-q provider", () => {
  beforeEach(() => refreshKiroToken.mockReset());

  it("shares Kiro's transport and catalog under its own id and alias", () => {
    expect(PROVIDERS["amazon-q"].format).toBe("kiro");
    expect(PROVIDERS["amazon-q"].baseUrl).toBe(PROVIDERS.kiro.baseUrl);
    expect(PROVIDERS["amazon-q"].tokenUrl).toBe(PROVIDERS.kiro.tokenUrl);
    expect(getModelsByProviderId("amazon-q").map((m) => m.id))
      .toEqual(getModelsByProviderId("kiro").map((m) => m.id));
    expect(resolveProviderAlias("aq")).toBe("amazon-q");
  });

  it("runs on KiroExecutor bound to the amazon-q id", () => {
    const executor = getExecutor("amazon-q");
    expect(executor).toBeInstanceOf(KiroExecutor);
    expect(executor.provider).toBe("amazon-q");
    expect(getExecutor("kiro").provider).toBe("kiro");
  });

  it("refreshes through the Kiro grant", async () => {
    refreshKiroToken.mockResolvedValue({ accessToken: "new" });
    const psd = { authMethod: "builder-id", region: "us-east-1" };
    await expect(refreshTokenByProvider("amazon-q", { refreshToken: "rt", providerSpecificData: psd }, null))
      .resolves.toEqual({ accessToken: "new" });
    expect(refreshKiroToken).toHaveBeenCalledWith("rt", psd, null, null);
  });

  it("uses Kiro's device login adapter", () => {
    expect(getProvider("amazon-q")).toBe(getProvider("kiro"));
    expect(getProvider("amazon-q").flowType).toBe("device_code");
  });

  it("gets Kiro's capability, thinking-level and pricing rules", () => {
    expect(isKiroFamilyProvider("amazon-q")).toBe(true);
    expect(isKiroFamilyProvider("aq")).toBe(true);
    expect(isKiroFamilyProvider("github")).toBe(false);
    for (const model of ["gpt-5.6-sol-thinking", "claude-sonnet-4-5"]) {
      expect(getCapabilitiesForModel("amazon-q", model)).toEqual(getCapabilitiesForModel("kiro", model));
      expect(getThinkingLevels("amazon-q", model)).toEqual(getThinkingLevels("kiro", model));
      expect(getPricingForModel("amazon-q", model)).toEqual(getPricingForModel("kiro", model));
    }
  });
});
