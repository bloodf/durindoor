import { describe, expect, it } from "vitest";
import { providerNodeLabels } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/grouping.js";

describe("OmniRoute #21200 a51dbad07f7700eeab42a8bb17e2963bfa456fb9 quota page node names", () => {
  it("labels a custom node by name, then prefix", () => {
    expect(providerNodeLabels([
      { id: "openai-compatible-chat-1", name: " My Gateway ", prefix: "gw" },
      { id: "anthropic-compatible-2", name: "", prefix: "cc" },
    ])).toEqual({ "openai-compatible-chat-1": "My Gateway", "anthropic-compatible-2": "cc" });
  });
  it("leaves nodes without a name or prefix, and bad input, on the raw id", () => {
    expect(providerNodeLabels([{ id: "openai-compatible-chat-3" }, null])).toEqual({});
    expect(providerNodeLabels(undefined)).toEqual({});
  });
});
