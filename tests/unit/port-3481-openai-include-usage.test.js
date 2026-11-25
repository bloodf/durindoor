import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const messages = [{ role: "user", content: "hi" }];
const transform = (provider, body, credentials = {}) =>
  new DefaultExecutor(provider).transformRequest("gpt-4.1", body, true, credentials);

describe("upstream #3481: streamed OpenAI Chat requests ask for usage", () => {
  it.each([
    ["no stream_options", undefined, { include_usage: true }],
    ["unrelated stream_options", { include_obfuscation: false }, { include_obfuscation: false, include_usage: true }],
  ])("requests usage for a client with %s", (_name, streamOptions, expected) => {
    const body = { messages, stream: true, ...(streamOptions ? { stream_options: streamOptions } : {}) };

    expect(transform("openai", body).stream_options).toEqual(expected);
  });

  it("keeps an explicit client opt-out", () => {
    const out = transform("openai", { messages, stream: true, stream_options: { include_usage: false } });

    expect(out.stream_options).toEqual({ include_usage: false });
  });

  it("does not add stream_options to a Responses body", () => {
    const out = transform("openai", { input: "hi", stream: true }, { runtimeTransport: { format: "openai-responses" } });

    expect(out.stream_options).toBeUndefined();
  });

  it("leaves another provider's stream_options as sent", () => {
    const out = transform("nan", { messages, stream: true, stream_options: { include_usage: false } });

    expect(out.stream_options).toEqual({ include_usage: false });
  });
});
