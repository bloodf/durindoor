import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

const TEXT_MODEL = "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";

describe("decolua/9router#4586 - Cloudflare messages carry valid content", () => {
  const run = (messages, caps = { vision: false }) => {
    const body = { messages };
    stripUnsupportedParams("cloudflare-ai", TEXT_MODEL, body, caps);
    return body.messages;
  };

  it("sends a string for missing, null, text-object and scalar content", () => {
    expect(run([
      { role: "assistant", tool_calls: [{ id: "call_1" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_2" }] },
      { role: "user", content: { type: "text", text: "hello" } },
      { role: "user", content: 42 },
      { role: "user", content: "plain" },
    ])).toEqual([
      { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
      { role: "assistant", content: "", tool_calls: [{ id: "call_2" }] },
      { role: "user", content: "hello" },
      { role: "user", content: "42" },
      { role: "user", content: "plain" },
    ]);
  });

  it("drops entries that are not messages because they have no role", () => {
    expect(run([null, { content: [{ type: "text", text: "orphan" }] }, { role: "user", content: "kept" }]))
      .toEqual([{ role: "user", content: "kept" }]);
  });

  it("still refuses a single non-text content object instead of dropping it (#6390)", () => {
    expect(() => run([{ role: "user", content: { type: "image_url", image_url: { url: "data:image/png;base64,xx" } } }]))
      .toThrow(/does not accept image\/non-text content parts/);
  });

  it("keeps content-part arrays for vision models and repairs null content", () => {
    const parts = [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }];
    expect(run([
      { role: "user", content: parts },
      { role: "user", content: parts[0] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1" }] },
    ], { vision: true })).toEqual([
      { role: "user", content: parts },
      { role: "user", content: parts },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
    ]);
  });

  it("does not mutate the caller's message objects", () => {
    const message = { role: "assistant", content: null };
    run([message]);
    expect(message.content).toBeNull();
  });

  it("leaves other providers untouched", () => {
    const body = { messages: [{ role: "assistant", content: null }] };
    stripUnsupportedParams("groq", "llama-3.3-70b", body);
    expect(body.messages[0].content).toBeNull();
  });
});
