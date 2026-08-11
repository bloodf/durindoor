import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// Provider registry: opencode is a generic OpenAI-compatible provider → DefaultExecutor.
const executor = new DefaultExecutor("opencode");

describe("DefaultExecutor stream_options injection (#3081)", () => {
  it("injects stream_options.include_usage for streaming requests", () => {
    const body = {
      model: "deepseek-v4-flash-free",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const out = executor.transformRequest("deepseek-v4-flash-free", body, true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("does not inject stream_options for non-streaming requests", () => {
    const body = {
      model: "deepseek-v4-flash-free",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const out = executor.transformRequest("deepseek-v4-flash-free", body, false);
    expect(out.stream_options).toBeUndefined();
  });

  it("respects an existing stream_options from the client", () => {
    const body = {
      model: "deepseek-v4-flash-free",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: false },
    };
    const out = executor.transformRequest("deepseek-v4-flash-free", body, true);
    expect(out.stream_options).toEqual({ include_usage: false });
  });
});

describe("DefaultExecutor stream_options transport guard", () => {
  const request = () => ({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  });

  it("does not inject OpenAI stream options for a direct Claude transport", () => {
    const out = new DefaultExecutor("claude").transformRequest("claude-opus-5", request(), true);
    expect(out.stream_options).toBeUndefined();
  });

  it("uses a runtime-selected Claude transport over an OpenAI provider default", () => {
    const out = executor.transformRequest("test-model", request(), true, {
      runtimeTransport: { format: "claude" },
    });
    expect(out.stream_options).toBeUndefined();
  });

  it.each(["openai", "openai-apikey"])(
    "injects usage options for a runtime-selected %s transport",
    (format) => {
      const out = new DefaultExecutor("claude").transformRequest("test-model", request(), true, {
        runtimeTransport: { format },
      });
      expect(out.stream_options).toEqual({ include_usage: true });
    },
  );
});
