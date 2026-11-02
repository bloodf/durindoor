import { describe, expect, it, vi } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { ROLE } from "../../open-sse/translator/schema/roles.js";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "test" }));
const normalize = (message, provider = "nvidia", model = "nvidia/nemotron") => {
  const body = { messages: [message] };
  stripUnsupportedParams(provider, model, body);
  return body.messages[0];
};

describe("NVIDIA assistant reasoning alias normalization", () => {
  it("keeps nonblank canonical content byte-for-byte and preserves unrelated fields", () => {
    const message = { role: ROLE.ASSISTANT, content: "answer", reasoning: "alias", reasoning_content: " canonical ", tool_calls: [] };
    expect(normalize(message)).toEqual({ role: ROLE.ASSISTANT, content: "answer", reasoning_content: " canonical ", tool_calls: [] });
    const once = structuredClone(message);
    expect(normalize(message)).toEqual(once);
  });
  it.each([undefined, null, "", " \n "])("fills replaceable canonical value %j from the alias", (canonical) => {
    expect(normalize({ role: ROLE.ASSISTANT, reasoning: "alias", reasoning_content: canonical }))
      .toEqual({ role: ROLE.ASSISTANT, reasoning_content: "alias" });
  });
  it.each([0, false, [], {}].map((value) => [value]))("retains nonstring canonical value %j without coercion", (canonical) => {
    expect(normalize({ role: ROLE.ASSISTANT, reasoning: "alias", reasoning_content: canonical }))
      .toEqual({ role: ROLE.ASSISTANT, reasoning_content: canonical });
  });
  it.each([null, "", " ", 0, false, [], {}].map((value) => [value]))("preserves defined alias value %j when moving it", (alias) => {
    expect(normalize({ role: ROLE.ASSISTANT, reasoning: alias }))
      .toEqual({ role: ROLE.ASSISTANT, reasoning_content: alias });
  });
  it("leaves absent or explicitly undefined aliases unchanged", () => {
    const onlyCanonical = { role: ROLE.ASSISTANT, reasoning_content: "canonical" };
    expect(normalize({ ...onlyCanonical })).toEqual(onlyCanonical);
    const explicitUndefined = { role: ROLE.ASSISTANT, reasoning: undefined };
    expect(normalize(explicitUndefined)).toEqual({ role: ROLE.ASSISTANT, reasoning: undefined });
    expect(Object.hasOwn(explicitUndefined, "reasoning")).toBe(true);
  });
  it.each([ROLE.USER, ROLE.SYSTEM, ROLE.TOOL])("does not alter %s turns", (role) => {
    const message = { role, reasoning: "alias", reasoning_content: "canonical" };
    expect(normalize(message)).toEqual({ role, reasoning: "alias", reasoning_content: "canonical" });
  });
  it.each(["deepseek", "openrouter", "openai-compatible-custom"])("does not alter %s assistant aliases", (provider) => {
    expect(normalize({ role: ROLE.ASSISTANT, reasoning: "alias" }, provider))
      .toEqual({ role: ROLE.ASSISTANT, reasoning: "alias" });
  });
  it("safely ignores malformed message entries and absent/nonarray histories", () => {
    const body = { messages: [null, 7, false, "text", { role: ROLE.ASSISTANT, reasoning: "alias" }] };
    stripUnsupportedParams("nvidia", "nvidia/nemotron", body);
    expect(body.messages).toEqual([null, 7, false, "text", { role: ROLE.ASSISTANT, reasoning_content: "alias" }]);
    for (const input of [{}, { messages: null }, { messages: {} }]) {
      const before = structuredClone(input); stripUnsupportedParams("nvidia", "nvidia/nemotron", input);
      expect(input).toEqual(before);
    }
  });
  it("coexists with GLM-5.2 top-level stripping", () => {
    const body = { reasoning: { effort: "high" }, thinking: { type: "enabled" }, messages: [{ role: ROLE.ASSISTANT, reasoning: "history" }] };
    stripUnsupportedParams("nvidia", "z-ai/glm-5.2", body);
    expect(body).toEqual({ messages: [{ role: ROLE.ASSISTANT, reasoning_content: "history" }] });
  });
  it.each([false, true])("renames before DeepSeek placeholder injection (stream=%s)", (stream) => {
    const output = new DefaultExecutor("nvidia").transformRequest("deepseek-ai/deepseek-v4-pro", {
      messages: [
        { role: ROLE.ASSISTANT, content: "", reasoning: "alias", reasoning_content: "canonical" },
        { role: ROLE.ASSISTANT, content: "", reasoning: "alias only" },
        { role: ROLE.ASSISTANT, content: "", reasoning_content: "canonical only" },
      ],
    }, stream, {});
    expect(output.messages).toEqual([
      { role: ROLE.ASSISTANT, content: "", reasoning_content: "canonical" },
      { role: ROLE.ASSISTANT, content: "", reasoning_content: "alias only" },
      { role: ROLE.ASSISTANT, content: "", reasoning_content: "canonical only" },
    ]);
    expect(JSON.stringify(output.messages)).not.toContain('"reasoning":');
  });
});
