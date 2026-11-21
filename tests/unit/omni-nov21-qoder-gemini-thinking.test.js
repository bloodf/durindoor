import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { __test__ as qoderInternals } from "../../open-sse/executors/qoder.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { isBillingBlock } = qoderInternals;

describe("#1073 Qoder nested billing codes", () => {
  it.each([110, "110", 112, "112"])("recognizes nested code %s as a billing block", (code) => {
    const body = JSON.stringify({ error: { details: JSON.stringify({ code }) } });
    expect(isBillingBlock(body)).toBe(true);
  });

  it.each([110, "110", 112, "112"])("keeps top-level code %s compatible", (code) => {
    expect(isBillingBlock(JSON.stringify({ code }))).toBe(true);
  });

  it("leaves unrelated nested errors and transient queue capacity retryable", () => {
    expect(isBillingBlock(JSON.stringify({ error: { details: { code: 500 } } }))).toBe(false);
    expect(isBillingBlock(JSON.stringify({ error: { details: { code: "10605", message: "queued" } } }))).toBe(false);
  });
});

function geminiThinking(body, model = "gemini-3.8-flash") {
  return translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, model, {
    messages: [{ role: "user", content: "hi" }],
    ...body,
  }, false, null, "gemini").generationConfig.thinkingConfig;
}

describe("#1073 Gemini explicit thinking levels", () => {
  it("trims and lowercases supported native levels", () => {
    expect(geminiThinking({ generationConfig: { thinkingConfig: { thinkingLevel: "  MeDiUm " } } }).thinkingLevel)
      .toBe("medium");
  });

  it("skips invalid nested candidates and uses valid snake_case top-level fallback", () => {
    expect(geminiThinking({
      generationConfig: { thinking_config: { thinking_level: " extreme " } },
      thinking_level: " HIGH ",
    }).thinkingLevel).toBe("high");
  });

  it("skips blank candidates and continues through camelCase candidates", () => {
    expect(geminiThinking({
      thinkingConfig: { thinkingLevel: "   " },
      thinkingLevel: " LOW ",
    }).thinkingLevel).toBe("low");
  });

  it("retains legacy Gemini budget-model handling", () => {
    const config = geminiThinking({ thinkingLevel: "medium" }, "gemini-2.5-flash");
    expect(config.thinkingBudget).toBeGreaterThan(0);
    expect(config.thinkingLevel).toBeUndefined();
  });
});
