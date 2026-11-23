import { describe, expect, it } from "vitest";
import { DefaultExecutor, hoistOpenAIResponsesInstructionsToInput } from "../../open-sse/executors/default.js";

const user = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });

describe("OpenAI Responses instructions hoist (port of OmniRoute #20854)", () => {
  it("moves instructions into input as a leading developer item on the openai provider", () => {
    const body = { model: "gpt-5.4", instructions: "Be helpful.", input: [user("Hello")], stream: true };
    const out = new DefaultExecutor("openai").transformRequest("gpt-5.4", body, true, {});
    expect("instructions" in out).toBe(false);
    expect(out.input).toEqual([
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Be helpful." }] },
      user("Hello")
    ]);
    expect(body.instructions).toBe("Be helpful.");
    expect(body.input).toHaveLength(1);
  });

  it("normalizes string input when prepending", () => {
    const out = hoistOpenAIResponsesInstructionsToInput({ instructions: "Be concise.", input: "Explain caching." });
    expect(out.input).toEqual([
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Be concise." }] },
      user("Explain caching.")
    ]);
  });

  it("keeps instructions for stateful continuations", () => {
    const a = hoistOpenAIResponsesInstructionsToInput({ previous_response_id: "resp_1", instructions: "S", input: [user("x")] });
    const b = hoistOpenAIResponsesInstructionsToInput({ conversation: "conv_1", instructions: "S", input: [user("x")] });
    expect(a.instructions).toBe("S");
    expect(b.instructions).toBe("S");
    expect(a.input).toHaveLength(1);
    expect(b.input).toHaveLength(1);
  });

  it("treats null conversation / previous_response_id as a stateless request", () => {
    const out = hoistOpenAIResponsesInstructionsToInput({ conversation: null, previous_response_id: null, instructions: "S", input: [user("x")] });
    expect("instructions" in out).toBe(false);
    expect(out.input[0].role).toBe("developer");
  });

  it("leaves chat bodies, empty instructions and other providers untouched", () => {
    const chat = { messages: [{ role: "user", content: "hi" }], instructions: "ignored" };
    expect(hoistOpenAIResponsesInstructionsToInput(chat)).toBe(chat);
    const blank = { instructions: "  ", input: [user("x")] };
    expect(hoistOpenAIResponsesInstructionsToInput(blank)).toBe(blank);
    const other = new DefaultExecutor("openai-compatible-responses-custom").transformRequest(
      "m", { instructions: "keep", input: [user("x")] }, true, { providerSpecificData: { apiType: "responses", baseUrl: "https://example.com/v1" } }
    );
    expect(other.instructions).toBe("keep");
  });
});
