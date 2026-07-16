// Port of OmniRoute #7054: Ollama Cloud must be registered for usage fetching.
// OmniRoute adds "ollama-cloud" to USAGE_FETCHER_PROVIDERS; durindoor's equivalent
// is the registry `features.usageApikey` flag (USAGE_APIKEY_PROVIDERS is derived
// from it), because cloud connections authenticate with an API key and the
// /api/usage/[connectionId] route rejects apikey providers not in that list.
import { describe, it, expect } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";

describe("ollama cloud usage registration (#7054)", () => {
  it("cloud registry entry exposes usage + usageApikey", () => {
    const cloud = REGISTRY.find((r) => r.id === "ollama");
    expect(cloud, "ollama cloud registry entry").toBeTruthy();
    expect(cloud.features?.usage).toBe(true);
    expect(cloud.features?.usageApikey).toBe(true);
  });

  it("cloud is in both derived usage lists", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("ollama");
    expect(USAGE_APIKEY_PROVIDERS).toContain("ollama");
  });

  it("local ollama stays unregistered", () => {
    const local = REGISTRY.find((r) => r.id === "ollama-local");
    expect(local, "ollama-local registry entry").toBeTruthy();
    expect(local.features?.usage).toBeFalsy();
    expect(local.features?.usageApikey).toBeFalsy();
    expect(USAGE_SUPPORTED_PROVIDERS).not.toContain("ollama-local");
    expect(USAGE_APIKEY_PROVIDERS).not.toContain("ollama-local");
  });

  it("dispatcher routes ollama to the graceful cloud usage message", async () => {
    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({ provider: "ollama", accessToken: "test-key" });
    expect(usage.quotas).toEqual([]);
    expect(usage.message).toMatch(/ollama\.com\/settings\/keys/i);
  });
});
