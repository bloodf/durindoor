// OpenAI → Kiro (AWS CodeWhisperer) request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

const O2K = (body, stream = true) => translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "m", body, stream, null, "kiro");

describe("OpenAI → Kiro", () => {
  // openai-to-kiro.js — safeJSONParse guards bad tool-call JSON (fixed in PR #1582)
  it("malformed tool arguments do not throw the whole request", () => {
    expect(() =>
      O2K({
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "", tool_calls: [
            { id: "c1", type: "function", function: { name: "f", arguments: "{not json" } },
          ] },
          { role: "tool", tool_call_id: "c1", content: "r" },
        ],
      })
    ).not.toThrow();
  });

  describe.each([true, false])("output ceilings (stream=%s)", (stream) => {
    const messages = [{ role: ROLE.USER, content: "hi" }];

    it.each(["max_tokens", "max_completion_tokens"])("rejects unsupported %s ceilings with 400", (field) => {
      expect(() => O2K({ [field]: 100, messages }, stream)).toThrowError(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining(`Kiro cannot enforce ${field}`),
      }));
    });

    it.each(["max_tokens", "max_completion_tokens"])("validates %s before rejecting enforcement", (field) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, "100", true, {}, []]) {
        expect(() => O2K({ [field]: value, messages }, stream)).toThrowError(expect.objectContaining({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: `${field} must be a finite positive integer.`,
        }));
      }
    });

    it("uses max_tokens before max_completion_tokens with nullish fallback", () => {
      for (const max_tokens of [100, 0, null, undefined]) {
        const field = max_tokens == null ? "max_completion_tokens" : "max_tokens";
        expect(() => O2K({ max_tokens, max_completion_tokens: 200, messages }, stream))
          .toThrowError(expect.objectContaining({
            statusCode: HTTP_STATUS.BAD_REQUEST,
            message: max_tokens === 0 ? `${field} must be a finite positive integer.` : expect.stringContaining(`Kiro cannot enforce ${field}`),
          }));
      }
    });

    it("preserves uncapped translation and sampling settings", () => {
      const out = O2K({ messages, temperature: 0.2, top_p: 0.9 }, stream);
      expect(out.inferenceConfig).toEqual({ maxTokens: 32000, temperature: 0.2, topP: 0.9 });
      expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hi");
    });

    it("leaves native Kiro output settings unchanged", () => {
      const body = {
        conversationState: { currentMessage: { userInputMessage: { content: "hi", modelId: "m" } }, history: [] },
        inferenceConfig: { maxTokens: 100 },
      };
      const out = translateRequest(FORMATS.KIRO, FORMATS.KIRO, "m", body, stream, null, "kiro");
      expect(out).toBe(body);
      expect(out.inferenceConfig).toEqual({ maxTokens: 100 });
      expect(out.conversationState.currentMessage.userInputMessage.content).toBe("hi");
    });
  });

  // openai-to-kiro.js:132-134 — remote http image becomes "[Image: url]" text (lost)
  // KNOWN BUG
  it.fails("remote image url is preserved as an image, not text", () => {
    const out = O2K({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://x.com/p.png" } },
      ] }],
    });
    const content = out.conversationState?.currentMessage?.userInputMessage?.content || "";
    expect(content, "remote image flattened to text").not.toContain("[Image:");
  });
});
