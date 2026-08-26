import { describe, expect, it } from "vitest";
import { buildProviderActivity } from "../../src/app/(dashboard)/dashboard/usage/components/providerTopologyData.js";
import { getProviderNodeAccessibility } from "../../src/app/(dashboard)/dashboard/usage/components/providerNodeAccessibility.js";

describe("provider topology active API keys", () => {
  it("groups active keys by provider and model across accounts", () => {
    expect(buildProviderActivity([
      {
        provider: "Codex",
        model: "gpt-5.6",
        account: "Primary",
        count: 2,
        keys: [{ name: "OMP Production", count: 2 }],
      },
      {
        provider: "codex",
        model: "gpt-5.6",
        account: "Backup",
        count: 2,
        keys: [
          { name: "Cursor Dev", count: 1 },
          { name: "OMP Production", count: 1 },
        ],
      },
      {
        provider: "codex",
        model: "gpt-5.5",
        account: "Primary",
        count: 1,
        keys: [{ name: "OMP Production", count: 1 }],
      },
    ])).toEqual({
      codex: [
        {
          model: "gpt-5.5",
          count: 1,
          keys: [{ name: "OMP Production", count: 1 }],
        },
        {
          model: "gpt-5.6",
          count: 4,
          keys: [
            { name: "Cursor Dev", count: 1 },
            { name: "OMP Production", count: 3 },
          ],
        },
      ],
    });
  });

  it("makes only active nodes keyboard focusable and described by the tooltip", () => {
    expect(getProviderNodeAccessibility(true, "codex-active-keys")).toEqual({
      tabIndex: 0,
      "aria-describedby": "codex-active-keys",
    });
    expect(getProviderNodeAccessibility(false, "codex-active-keys")).toEqual({});
  });
});
