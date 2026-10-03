import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveOpenAiEffort } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { fallbackConnectionModels } from "../../src/app/(dashboard)/dashboard/cli-tools/connectionModels.js";


describe("GPT-6 Astra effort resolution", () => {
  const astraCaps = {
    reasoning: true,
    thinkingCanDisable: false,
    thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
  };

  it("floors unsupported disabled-thinking levels to low", () => {
    for (const level of ["none", "minimal"]) {
      expect(resolveOpenAiEffort(level, "openai", "gpt-6-astra", astraCaps)).toBe("low");
    }
  });

  it("preserves supported max", () => {
    expect(resolveOpenAiEffort("max", "openai", "gpt-6-astra", astraCaps)).toBe("max");
  });
});


describe("GPT-6 Astra request sanitization", () => {
  it("strips unsupported sampling and Chat logprob controls on the direct API", () => {
    const body = { temperature: 0.7, top_p: 0.9, top_logprobs: 3, logprobs: true, messages: [] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body).toEqual({ messages: [] });
  });

  it("drops only the message.output_text.logprobs Responses include entry", () => {
    const body = { include: ["reasoning.encrypted_content", "message.output_text.logprobs"] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("removes include entirely when it becomes empty", () => {
    const body = { include: ["message.output_text.logprobs"] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body.include).toBeUndefined();
  });

  it("does not strip Chat-only logprobs from a Responses-shaped body", () => {
    const body = { logprobs: true, input: [] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body).toEqual({ logprobs: true, input: [] });
  });

  it("leaves unrelated OpenAI models' sampling params untouched", () => {
    const body = { temperature: 0.7, top_p: 0.9 };
    stripUnsupportedParams("openai", "gpt-5.6", body);
    expect(body).toEqual({ temperature: 0.7, top_p: 0.9 });
  });
});

describe("GPT-6 Astra final OpenAI request path", () => {
  it("strips Chat logprobs through DefaultExecutor", () => {
    const body = new DefaultExecutor("openai").transformRequest("gpt-6-astra", {
      messages: [{ role: "user", content: "hi" }], logprobs: true, top_logprobs: 2,
    });
    expect(body.logprobs).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
  });
});

// Registry default only affects new connections and the picker suggestion.
// Existing connection.defaultModel remains source of truth for that connection.
describe("GPT-6 Astra registry default preserves saved connections", () => {
  it("keeps a saved prior default model in connection model fallback", () => {
    const savedConnection = { defaultModel: "gpt-5.6", providerSpecificData: {} };
    expect(fallbackConnectionModels(savedConnection)).toEqual([
      { id: "gpt-5.6", name: "gpt-5.6" },
    ]);
    expect(savedConnection).toEqual({ defaultModel: "gpt-5.6", providerSpecificData: {} });
  });
});
