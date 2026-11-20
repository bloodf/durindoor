import { expect, it } from "vitest";
import { resolveOpenAiEffort } from "../../open-sse/translator/concerns/thinkingUnified.js";

it("resolves adaptive intent to an accepted OpenAI effort", () => {
  expect(resolveOpenAiEffort("auto", "unknown", "unknown", {})).toBe("high");
});
