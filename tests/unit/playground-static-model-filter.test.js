import { describe, expect, it } from "vitest";
import { isChatModel } from "../../src/shared/constants/models";

describe("isChatModel (PR 311)", () => {
  it("rejects agent-only models", () => {
    expect(isChatModel({ id: "devin", name: "Devin", kind: "agent" })).toBe(false);
  });

  it("accepts legacy untyped models as chat", () => {
    expect(isChatModel({ id: "gpt-4", name: "GPT-4" })).toBe(true);
  });

  it("accepts typed llm models", () => {
    expect(isChatModel({ id: "m", kind: "llm" })).toBe(true);
  });

  it("rejects embedding models", () => {
    expect(isChatModel({ id: "e", kind: "embedding" })).toBe(false);
  });
});
