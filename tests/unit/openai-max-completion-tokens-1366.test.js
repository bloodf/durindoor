import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { applyParamRenames, stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("OpenAI max_completion_tokens port (#1366)", () => {
  it.each(["gpt-6-sol", "gpt-6.1-terra", "gpt-5.4", "o3", "gpt-4o"])("renames the OpenAI token cap for %s", (model) => {
    const body = { max_tokens: 123 };
    stripUnsupportedParams("openai", model, body);
    expect(body).toEqual({ max_completion_tokens: 123 });
  });

  it.each([false, true])("preserves explicit target precedence on the Chat executor transform (stream=%s)", (stream) => {
    const body = { messages: [{ role: "user", content: "hello" }], max_tokens: 100, max_completion_tokens: 23 };
    const out = new DefaultExecutor("openai").transformRequest("gpt-6-sol", body, stream, {});
    expect(out.max_completion_tokens).toBe(23);
    expect(out).not.toHaveProperty("max_tokens");
    expect(out.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it.each([0, 17])("retains a lone explicit target value %s", (value) => {
    const body = { max_completion_tokens: value };
    applyParamRenames("openai", "gpt-6.1-terra", body);
    stripUnsupportedParams("openai", "gpt-6.1-terra", body);
    expect(body).toEqual({ max_completion_tokens: value });
  });

  it.each(["openai-compatible-custom", "deepseek", "github"])("does not impose OpenAI spelling on %s", (provider) => {
    const body = { max_tokens: 100, max_completion_tokens: 23 };
    applyParamRenames(provider, "gpt-6-sol", body);
    stripUnsupportedParams(provider, "gpt-6-sol", body);
    expect(body).toEqual({ max_tokens: 100 });
  });

  it("applies configured ceiling clamps after renaming", () => {
    const body = { max_tokens: 100 };
    stripUnsupportedParams("openai", "gpt-6-sol", body, null, [
      { provider: "openai", renameParams: { max_tokens: "max_completion_tokens" }, maxOutputCap: 42 },
    ]);
    expect(body).toEqual({ max_completion_tokens: 42 });
  });

  it("leaves the native Responses output cap unchanged", () => {
    const body = { input: "hello", max_output_tokens: 123 };
    applyParamRenames("openai", "gpt-6-sol", body);
    stripUnsupportedParams("openai", "gpt-6-sol", body);
    expect(body).toEqual({ input: "hello", max_output_tokens: 123 });
  });
});
