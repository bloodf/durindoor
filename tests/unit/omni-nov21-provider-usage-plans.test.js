import { describe, it, expect } from "vitest";

import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { getProviderQuotaAdapter } from "../../open-sse/services/quota/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

// OmniRoute #20293 (Mistral quota/plan) and #20347 (Command Code plan aliases and caps)
// amend usage mappers that DurinDoor does not have. These assertions pin the
// preconditions behind the "not applicable" disposition in
// internal/docs/port-reports/1073-20895-train-e2.md. If a lane adds a Mistral or
// Command Code usage mapper, port the plan/cap behavior there and update this file.
// Upstream #4025 added the `commandcode` mapper and #20347 is ported onto it (see
// commandcode-usage.test.js), so that id is pinned separately at the end.
const PROVIDERS = ["mistral", "command-code"];

describe("omni Nov 21 provider usage plans: no local mapper to amend", () => {
  for (const provider of PROVIDERS) {
    it(`${provider} has no usage handler, quota adapter or usage feature flag`, async () => {
      const result = await getUsageForProvider({ provider, apiKey: "sk-fixture-not-sent" });
      expect(result.message).toBe(`Usage API not implemented for ${provider}`);
      expect(result.quotas).toBeUndefined();
      expect(getProviderQuotaAdapter(provider)).toBeNull();
      expect(USAGE_SUPPORTED_PROVIDERS).not.toContain(provider);
      expect(USAGE_APIKEY_PROVIDERS).not.toContain(provider);
    });
  }
});

describe("commandcode after upstream #4025", () => {
  it("has a usage handler and API-key feature flags but still no routing quota adapter", async () => {
    // No key, so the handler answers without calling upstream.
    const result = await getUsageForProvider({ provider: "commandcode" });
    expect(result.message).toBe("Command Code API key not available. Add a key to view usage.");
    expect(result.quotas).toBeUndefined();
    expect(getProviderQuotaAdapter("commandcode")).toBeNull();
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("commandcode");
    expect(USAGE_APIKEY_PROVIDERS).toContain("commandcode");
  });
});
