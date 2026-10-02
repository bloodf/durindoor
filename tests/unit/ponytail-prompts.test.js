import { describe, expect, it } from "vitest";
import { PONYTAIL_LEVELS, PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Ponytail prompts", () => {
  it.each(Object.values(PONYTAIL_LEVELS))("resolves and injects %s", (level) => {
    expect(PONYTAIL_PROMPTS[level]).toEqual(expect.any(String));
    expect(PONYTAIL_PROMPTS[level].trim()).not.toBe("");

    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, level);

    expect(body.messages[0]).toEqual({ role: "system", content: PONYTAIL_PROMPTS[level] });
  });

  it("preserves upstream ladder, root-cause, and safety rules", () => {
    const prompt = PONYTAIL_PROMPTS[PONYTAIL_LEVELS.FULL];

    expect(prompt).toContain("Speculative need = skip it, say so in one line.");
    expect(prompt).toContain("The ladder is a reflex, not a research project");
    expect(prompt).toContain("Bug fix = root cause, not symptom.");
    expect(prompt).toContain("Never stall on an answer you can default.");
    expect(prompt).toContain("No frameworks, no fixtures, no per-function suites unless asked.");
  });

  it.each([
    [PONYTAIL_LEVELS.LITE, "Lite: build what's asked, but name the lazier alternative in one line. User picks."],
    [PONYTAIL_LEVELS.FULL, "Full: the ladder enforced. Stdlib and native first. Shortest diff, shortest explanation."],
    [PONYTAIL_LEVELS.ULTRA, "Ultra: YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same response."],
  ])("preserves %s intensity directive", (level, directive) => {
    expect(PONYTAIL_PROMPTS[level]).toContain(directive);
  });
});
