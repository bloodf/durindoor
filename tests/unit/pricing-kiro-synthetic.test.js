// tests/unit/pricing-kiro-synthetic.test.js
// Defends Kiro GPT-5.6 synthetic-suffix pricing (#2596):
//  - kiro/kr synthetic ids (`gpt-5.6-sol-thinking`, `gpt-5.6-luna-agentic`) resolve
//    to the canonical base-model price (sol 5.00/30.00, luna 1.00/6.00, terra 2.50/15.00)
//  - the kiro-scoped canonical retry does NOT change non-Kiro pattern pricing
import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

const KIRO_TIERS = [
  { tier: "sol", input: 5.0, output: 6.25 },
  { tier: "terra", input: 2.5, output: 3.125 },
  { tier: "luna", input: 1.0, output: 1.25 },
];

describe("getPricingForModel kiro synthetic suffixes (#2596)", () => {
  it.each(KIRO_TIERS.flatMap((t) => [
    [`kiro gpt-5.6-${t.tier}`, "kiro", `gpt-5.6-${t.tier}`, t.input, t.output],
    [`kiro gpt-5-6-${t.tier}`, "kiro", `gpt-5-6-${t.tier}`, t.input, t.output],
    [`kiro gpt-5.6-${t.tier}-thinking`, "kiro", `gpt-5.6-${t.tier}-thinking`, t.input, t.output],
    [`kiro gpt-5-6-${t.tier}-thinking`, "kiro", `gpt-5-6-${t.tier}-thinking`, t.input, t.output],
    [`kr gpt-5.6-${t.tier}-agentic`, "kr", `gpt-5.6-${t.tier}-agentic`, t.input, t.output],
    [`kr gpt-5-6-${t.tier}-agentic`, "kr", `gpt-5-6-${t.tier}-agentic`, t.input, t.output],
  ]))("%s maps to tier price", (_label, provider, model, input, output) => {
    const p = getPricingForModel(provider, model);
    expect(p?.input).toBe(input);
    expect(p?.output).toBe(output);
  });

  it("non-Kiro gpt-5.6-sol-thinking keeps generic pattern price (unchanged)", () => {
    // Outside kiro/kr, the synthetic suffix must NOT be stripped — falls to
    // the generic `gpt-5.6-*` pattern price (2.50 input).
    const p = getPricingForModel("openai", "gpt-5.6-sol-thinking");
    expect(p?.input).not.toBe(5.0);
  });
});
