import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";
import { BUILDERS } from "../translator/real/all-format-bodies.js";
import { positiveProviderBody } from "../translator/real/positive-provider-body.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/test",
}));

const model = "claude-sonnet-4.5";
const cases = Object.entries(BUILDERS).flatMap(([format, scenarios]) =>
  Object.entries(scenarios).map(([scenario, build]) => ({ format, scenario, build })));
const translate = (format, body) => translateRequest(format, FORMATS.KIRO, model,
  structuredClone(body), true, null, "kiro");

describe.each(cases)("positive provider fixture $format / $scenario", ({ format, build }) => {
  it("keeps the non-Kiro request and its ceiling unchanged", () => {
    const body = build();
    const original = structuredClone(body);
    expect(positiveProviderBody("gemini", body)).toBe(body);
    expect(body).toEqual(original);
  });

  it("omits only Kiro output ceilings without mutating the fixture", () => {
    const body = build();
    const original = structuredClone(body);
    const result = positiveProviderBody("kiro", body);
    const actualPayload = result.request || result;
    const originalPayload = original.request || original;
    // Exact equality of every remaining field preserves content, tools, sampling
    // and thinking budgets; output ceilings are a different contract.
    const { max_tokens, max_completion_tokens, max_output_tokens, generationConfig, ...rest } = originalPayload;
    const expected = { ...rest };
    if (generationConfig) {
      const { maxOutputTokens, ...config } = generationConfig;
      expected.generationConfig = config;
      expect(maxOutputTokens).toBeGreaterThan(0);
    } else {
      expect(max_tokens ?? max_completion_tokens ?? max_output_tokens).toBeGreaterThan(0);
    }
    expect(actualPayload).toEqual(expected);
    if (original.request) expect(result).toEqual({ ...original, request: expected });
    expect(body).toEqual(original);
    const translated = translate(format, result);
    expect(translated.conversationState.currentMessage.userInputMessage.modelId).toBe(model);
    expect(translated.conversationState.currentMessage.userInputMessage.content.length).toBeGreaterThan(0);
  });

  it("still rejects the original explicit ceiling through the registered translator", () => {
    expect(() => translate(format, build())).toThrowError(expect.objectContaining({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: expect.stringContaining("Kiro cannot enforce max_tokens output ceilings"),
    }));
  });
});

it.each(["max_tokens", "max_completion_tokens", "max_output_tokens"])("handles %s without changing thinking or caller input", (field) => {
  const body = { [field]: 32, messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled", budget_tokens: 1024 } };
  const original = structuredClone(body);
  expect(positiveProviderBody("kiro", body)).toEqual({ messages: body.messages, thinking: body.thinking });
  expect(positiveProviderBody("codex", body)).toEqual(original);
  expect(body).toEqual(original);
});
