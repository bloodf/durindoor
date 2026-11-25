import { describe, expect, it } from "vitest";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const entry = (id) => REGISTRY.find((p) => p.id === id);
const note = (id) => entry(id).display.notice.text;

describe("OmniRoute #21123 (49a2394efd4b) provider copy for ended free offers", () => {
  it("drops the free flag from ended offers", () => {
    for (const id of ["huggingface", "ollama"]) expect(AI_PROVIDERS[id].hasFree, id).not.toBe(true);
  });

  it("states why each ended offer ended, with the check date", () => {
    for (const id of ["huggingface", "ollama", "bluesminds", "nara", "navy", "dxnt", "stepfun", "poolside", "amazon-q"]) {
      expect(note(id), id).toContain("checked 2026-11-23");
    }
    expect(note("bluesminds")).not.toMatch(/free daily credits/i);
    expect(note("nara")).not.toMatch(/7M tokens/i);
    expect(note("navy")).not.toMatch(/150K tokens/i);
    expect(note("ollama")).not.toMatch(/Free tier:/i);
    expect(note("amazon-q")).toContain("2026-05-15");
  });

  it("keeps upstream's remaining offers and names their gate", () => {
    expect(note("vertex")).toMatch(/payment method/i);
    expect(note("aion")).toMatch(/payment card/i);
    expect(note("bazaarlink")).toMatch(/60 weighted/);
    expect(note("bazaarlink")).not.toMatch(/4M tokens/);
  });
});
