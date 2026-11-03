import { describe, expect, it } from "vitest";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Upstream acb3c080 lists gpt-6.1-terra for Codex. Window handling follows the other
// Codex GPT-6 rows (API specification), see model-metadata-resolution.test.js.
describe("Codex gpt-6.1-terra", () => {
  it("is listed for Codex and resolves like its siblings", () => {
    expect(getModelsByProviderId("codex").some((m) => m.id === "gpt-6.1-terra")).toBe(true);
    expect(getCapabilitiesForModel("codex", "gpt-6.1-terra")).toMatchObject({ reasoning: true, vision: true });
    expect(getPricingForModel("codex", "gpt-6.1-terra")).toMatchObject({ input: 1, output: 5 });
  });
});
