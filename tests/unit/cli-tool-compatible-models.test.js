import { describe, expect, it } from "vitest";
import { fallbackConnectionModels } from "../../src/app/(dashboard)/dashboard/cli-tools/connectionModels.js";

describe("fallbackConnectionModels", () => {
  it("uses compatible connection default and custom models when catalog has none", () => {
    expect(fallbackConnectionModels({
      defaultModel: "gpt-4.1-mini",
      providerSpecificData: {
        customModels: [
          { id: "gpt-4.1-mini", name: "Duplicate" },
          { id: "claude-sonnet", name: "Claude Sonnet" },
        ],
      },
    })).toEqual([
      { id: "gpt-4.1-mini", name: "gpt-4.1-mini" },
      { id: "claude-sonnet", name: "Claude Sonnet" },
    ]);
  });

  it("offers a placeholder only for active connections with no model metadata", () => {
    expect(fallbackConnectionModels({ testStatus: "active" })).toEqual([
      { id: "model-id", name: "model-id" },
    ]);
    expect(fallbackConnectionModels({ testStatus: "unknown" })).toEqual([]);
  });
});
