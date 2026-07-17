// tests/unit/kiro-mitm-model-map.test.js
// Defends Kiro GPT-5.6 MITM model-alias resolution (#2596):
//  - digit-dash Kiro GPT-5.6 ids (`gpt-5-6-sol`) normalize to dotted (`gpt-5.6-sol`)
//  - longest-key one-directional prefix match (a short alias must not hijack a longer id)
//  - no reverse prefix match (a request for `gpt` must not pick `gpt-5.6-sol`)
// Aliases are injected as the third arg to avoid the native better-sqlite3 dependency.
import { describe, it, expect } from "vitest";

const { getMappedOverride } = require("../../src/mitm/server.js");

describe("getMappedOverride kiro GPT-5.6 alias resolution (#2596)", () => {
  const aliases = {
    "gpt-5.6-sol": { type: "apikey", provider: "openai", model: "gpt-5.6-sol" },
    "gpt-5.6-luna": { type: "apikey", provider: "openai", model: "gpt-5.6-luna" },
    "gpt-5.6-terra": { type: "apikey", provider: "openai", model: "gpt-5.6-terra" },
  };

  it("resolves dotted Kiro GPT-5.6 ids exactly", () => {
    expect(getMappedOverride("kiro", "gpt-5.6-sol", aliases)?.model).toBe("gpt-5.6-sol");
    expect(getMappedOverride("kiro", "gpt-5.6-luna", aliases)?.model).toBe("gpt-5.6-luna");
    expect(getMappedOverride("kiro", "gpt-5.6-terra", aliases)?.model).toBe("gpt-5.6-terra");
  });

  it("normalizes digit-dash form to dotted before lookup", () => {
    expect(getMappedOverride("kiro", "gpt-5-6-sol", aliases)?.model).toBe("gpt-5.6-sol");
    expect(getMappedOverride("kiro", "gpt-5-6-luna", aliases)?.model).toBe("gpt-5.6-luna");
    expect(getMappedOverride("kiro", "gpt-5-6-terra", aliases)?.model).toBe("gpt-5.6-terra");
  });

  it("normalizes synthetic suffix variants (-thinking/-agentic) in dash form", () => {
    expect(getMappedOverride("kiro", "gpt-5-6-sol-thinking", aliases)?.model).toBe("gpt-5.6-sol");
    expect(getMappedOverride("kiro", "gpt-5-6-luna-agentic", aliases)?.model).toBe("gpt-5.6-luna");
  });

  it("does not apply digit-dash normalization for non-kiro tools", () => {
    // claude tool has no kiro normalization; `gpt-5-6-sol` stays dashed, exact miss, prefix miss
    expect(getMappedOverride("claude", "gpt-5-6-sol", aliases)).toBeNull();
  });

  it("picks the longest matching alias (short alias must not hijack)", () => {
    const mixed = {
      "gpt-5": { type: "apikey", provider: "openai", model: "gpt-5" },
      "gpt-5.6-sol": { type: "apikey", provider: "openai", model: "gpt-5.6-sol" },
    };
    // Digit-dash request normalizes to `gpt-5.6-sol`; longest prefix key wins over `gpt-5`.
    expect(getMappedOverride("kiro", "gpt-5-6-sol", mixed)?.model).toBe("gpt-5.6-sol");
  });

  it("does not reverse-prefix-match (request `gpt` must not pick `gpt-5.6-sol`)", () => {
    expect(getMappedOverride("kiro", "gpt", aliases)).toBeNull();
    expect(getMappedOverride("kiro", "gpt-5", aliases)).toBeNull();
  });

  it("prefix-matches dotted suffix variants to the base alias", () => {
    // Dotted synthetic ids: exact miss on `gpt-5.6-sol-thinking`, prefix `gpt-5.6-sol` matches.
    expect(getMappedOverride("kiro", "gpt-5.6-sol-thinking", aliases)?.model).toBe("gpt-5.6-sol");
    expect(getMappedOverride("kiro", "gpt-5.6-luna-agentic", aliases)?.model).toBe("gpt-5.6-luna");
  });

  it("returns null for null/empty model and null aliases", () => {
    expect(getMappedOverride("kiro", null, aliases)).toBeNull();
    expect(getMappedOverride("kiro", "gpt-5.6-sol", null)).toBeNull();
  });
});
