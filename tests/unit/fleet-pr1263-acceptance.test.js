import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";

// Translator registration imports the provider catalog; keep its UA refresh offline.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/test",
}));
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

const model = "claude-sonnet-4.5";

// The registered Claude route bypasses the OpenAI adapter. It must not claim
// output-limit support that the same Kiro upstream cannot guarantee.
describe.each([true, false])("Kiro direct-route output ceilings (stream=%s)", (stream) => {
  it.each([
    [100, "Kiro cannot enforce max_tokens"],
    [0, "max_tokens must be a finite positive integer."],
  ])("rejects Claude max_tokens=%s with a client error", (max_tokens, message) => {
    const body = { max_tokens, messages: [{ role: ROLE.USER, content: "hi" }] };
    expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, model, body, stream, null, "kiro"))
      .toThrowError(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining(message),
      }));
  });

  it("preserves uncapped Claude direct-route content and sampling", () => {
    const body = {
      system: "Keep answers short.",
      messages: [{ role: ROLE.USER, content: "hi" }],
      temperature: 0.2,
      top_p: 0.9,
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, model, body, stream, null, "kiro");
    expect(out.conversationState.currentMessage.userInputMessage).toMatchObject({
      modelId: model,
      systemInstruction: body.system,
      content: expect.stringContaining("hi"),
    });
    expect(out.inferenceConfig).toEqual({ maxTokens: 32000, temperature: 0.2, topP: 0.9 });
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
});
