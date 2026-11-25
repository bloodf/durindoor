import { expect, it } from "vitest";
import { aggregateComboCapabilities, getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

it("resolves thinking overrides before calculating combo model limits", () => {
  expect(aggregateComboCapabilities(["mistral/mistral-large-4(max)"]).contextWindow).toBe(1048576);
  expect(getCapabilitiesForModel("opencode", "jev-1.13-free").contextWindow).toBe(64000);
});
