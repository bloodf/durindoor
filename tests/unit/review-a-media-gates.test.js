import { describe, expect, it } from "vitest";
import { deriveModerationsUrl } from "../../open-sse/handlers/moderationsCore.js";

describe("issue 2282 media gate regressions", () => {
  it("does not invent a moderation endpoint for non-chat providers", () => {
    expect(deriveModerationsUrl("https://api.anthropic.com/v1/messages")).toBeNull();
  });
});
