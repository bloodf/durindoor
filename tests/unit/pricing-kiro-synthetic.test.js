// tests/unit/pricing-kiro-synthetic.test.js
// Defends Kiro GPT-5.6 synthetic-suffix pricing (#2596):
//  - kiro/kr synthetic ids (`gpt-5.6-sol-thinking`, `gpt-5.6-luna-agentic`) resolve
//    to the canonical base-model price (sol 5.00/30.00, luna 1.00/6.00, terra 2.50/15.00)
//  - the kiro-scoped canonical retry does NOT change non-Kiro pattern pricing
import { describe, it, expect } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("getPricingForModel kiro synthetic suffixes (#2596)", () => {
  it("kiro gpt-5.6-sol base price", () => {
    const p = getPricingForModel("kiro", "gpt-5.6-sol");
    expect(p?.input).toBe(5.0);
    expect(p?.output).toBe(30.0);
  });

  it("kiro gpt-5.6-sol-thinking strips synthetic suffix to Sol price", () => {
    const p = getPricingForModel("kiro", "gpt-5.6-sol-thinking");
    expect(p?.input).toBe(5.0);
    expect(p?.output).toBe(30.0);
  });

  it("kiro gpt-5.6-terra-agentic strips synthetic suffix to Terra price", () => {
    const p = getPricingForModel("kiro", "gpt-5.6-terra-agentic");
    expect(p?.input).toBe(2.5);
    expect(p?.output).toBe(15.0);
  });

  it("kr gpt-5.6-luna-thinking strips synthetic suffix to Luna price (kr alias)", () => {
    const p = getPricingForModel("kr", "gpt-5.6-luna-thinking");
    expect(p?.input).toBe(1.0);
    expect(p?.output).toBe(6.0);
  });

  it("kr gpt-5.6-luna-agentic strips synthetic suffix to Luna price", () => {
    const p = getPricingForModel("kr", "gpt-5.6-luna-agentic");
    expect(p?.input).toBe(1.0);
    expect(p?.output).toBe(6.0);
  });

  it("non-Kiro gpt-5.6-sol-thinking keeps generic pattern price (unchanged)", () => {
    // Outside kiro/kr, the synthetic suffix must NOT be stripped — falls to
    // the generic `gpt-5.6-*` pattern price (2.50 input).
    const p = getPricingForModel("openai", "gpt-5.6-sol-thinking");
    expect(p?.input).not.toBe(5.0);
  });
});
