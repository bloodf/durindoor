import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../../open-sse/providers/index.js";

describe("Kiro Opus 5 models (a8313cd32)", () => {
  const expectedIds = [
    "claude-opus-5",
    "claude-opus-5-thinking",
    "claude-opus-5-agentic",
    "claude-opus-5-thinking-agentic",
  ];

  it("exposes exactly the four Opus 5 public model IDs in order", () => {
    const actualIds = (PROVIDER_MODELS.kr || [])
      .map((m) => m.id)
      .filter((id) => id.startsWith("claude-opus-5"));
    expect(actualIds).toEqual(expectedIds);
  });
});
