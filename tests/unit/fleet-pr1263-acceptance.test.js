import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

// Translator registration imports the provider catalog; keep its UA refresh offline.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/test",
}));

const model = "claude-sonnet-4.5";

// Both registered direct routes must reject ceilings the Kiro upstream cannot guarantee.
describe.each([FORMATS.CLAUDE, FORMATS.OPENAI])("Kiro %s direct route", (sourceFormat) => {
  describe.each([true, false])("output ceilings (stream=%s)", (stream) => {
    const translate = (limits = {}) => translateRequest(sourceFormat, FORMATS.KIRO, model,
      { ...limits, messages: [{ role: ROLE.USER, content: "hi" }] }, stream, null, "kiro");

    it.each(["max_tokens", "max_completion_tokens"])("rejects unsupported %s", (field) => {
      expect(() => translate({ [field]: 100 })).toThrowError(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: `Kiro cannot enforce ${field} output ceilings; omit the limit or choose a provider that supports it.`,
      }));
    });

    it.each(["max_tokens", "max_completion_tokens"])("validates malformed %s", (field) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, "100", true, {}, []]) {
        expect(() => translate({ [field]: value })).toThrowError(expect.objectContaining({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: `${field} must be a finite positive integer.`,
        }));
      }
    });

    it("keeps max_tokens precedence and nullish fallback", () => {
      for (const max_tokens of [100, 0, null, undefined]) {
        const field = max_tokens == null ? "max_completion_tokens" : "max_tokens";
        expect(() => translate({ max_tokens, max_completion_tokens: 200 }))
          .toThrowError(expect.objectContaining({
            statusCode: HTTP_STATUS.BAD_REQUEST,
            message: max_tokens === 0 ? `${field} must be a finite positive integer.` : expect.stringContaining(`Kiro cannot enforce ${field}`),
          }));
      }
    });

    it("preserves uncapped content and sampling", () => {
      const out = translate({ system: "Keep answers short.", temperature: 0.2, top_p: 0.9 });
      if (sourceFormat === FORMATS.CLAUDE) {
        expect(out.conversationState.currentMessage.userInputMessage.systemInstruction).toBe("Keep answers short.");
      }
      expect(out.conversationState.currentMessage.userInputMessage).toMatchObject({
        modelId: model,
        content: expect.stringContaining("hi"),
      });
      expect(out.inferenceConfig).toEqual({ maxTokens: 32000, temperature: 0.2, topP: 0.9 });
      expect(translate({ max_tokens: null, max_completion_tokens: null }).inferenceConfig).toEqual({ maxTokens: 32000 });
    });
  });
});

// Responses reaches Kiro through the registered Responses -> OpenAI pivot.
describe.each([true, false])("Kiro Responses pivot (stream=%s)", (stream) => {
  it.each([
    [100, "Kiro cannot enforce max_tokens"],
    [0, "max_tokens must be a finite positive integer."],
  ])("rejects Responses max_output_tokens=%s after lowering", (max_output_tokens, message) => {
    const body = { input: "hi", max_output_tokens };
    expect(() => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.KIRO, model, body, stream, null, "kiro"))
      .toThrowError(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining(message),
      }));
  });

  it("preserves uncapped Responses input through the pivot", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.KIRO, model,
      { input: "hi", instructions: "Keep answers short." }, stream, null, "kiro");
    const current = out.conversationState.currentMessage.userInputMessage;
    expect(current.modelId).toBe(model);
    expect(current.content).toContain("hi");
    expect(current.content).toContain("Keep answers short.");
    expect(out.inferenceConfig).toEqual({ maxTokens: 32000 });
    expect(out).not.toHaveProperty("input");
    expect(out).not.toHaveProperty("max_output_tokens");
  });

  it("leaves native Kiro output settings unchanged", () => {
    const body = {
      conversationState: { currentMessage: { userInputMessage: { content: "hi", modelId: model } }, history: [] },
      inferenceConfig: { maxTokens: 100 },
    };
    const original = structuredClone(body);
    expect(translateRequest(FORMATS.KIRO, FORMATS.KIRO, model, body, stream, null, "kiro")).toBe(body);
    expect(body).toEqual(original);
  });
});
