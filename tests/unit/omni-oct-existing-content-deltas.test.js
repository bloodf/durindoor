import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { normalizeArrayContentDelta } from "../../open-sse/utils/arrayContentDelta.js";
import { createSSEStream, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { applyResponseMasking } from "../../open-sse/services/responseMasking.js";

const chunk = (delta, finish_reason = null) => ({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason }] });
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const parse = (text) => text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
const passthrough = () => createSSEStream({ mode: "passthrough", targetFormat: FORMATS.OPENAI, provider: "openai", model: "test" });
async function run(input, transform) {
  return new Response(new Response(input).body.pipeThrough(transform)).text();
}

describe("existing OpenAI stream content", () => {
  it("normalizes finite numbers including zero without changing other values", () => {
    for (const value of [0, 7, -1.5]) {
      const delta = { content: value };
      expect(normalizeArrayContentDelta(delta)).toBe(true);
      expect(delta.content).toBe(String(value));
    }
    for (const value of [NaN, Infinity, "text", null, { type: "unknown" }]) {
      const delta = { content: value };
      expect(normalizeArrayContentDelta(delta)).toBe(false);
      expect(delta.content).toBe(value);
    }
    const invalid = { content: [{ type: "unknown", data: "opaque" }] };
    normalizeArrayContentDelta(invalid);
    expect(invalid).toEqual({});
  });

  it("keeps numeric, string and role frames with terminal and usage frames", async () => {
    const usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };
    const input = [chunk({ role: "assistant", content: "" }), chunk({ content: "A" }), chunk({ content: 7 }), chunk({ content: 0 }), chunk({}, "stop"), { ...chunk({}), choices: [], usage }].map(frame).join("") + "data: [DONE]\n\n";
    const output = await run(input, passthrough());
    const events = parse(output);
    expect(events[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(events.flatMap((event) => event.choices.map((choice) => choice.delta.content ?? "")).join("")).toBe("A70");
    expect(events.some((event) => event.choices[0]?.finish_reason === "stop")).toBe(true);
    expect(events.some((event) => event.usage?.total_tokens === 5)).toBe(true);
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("preserves image frames and metadata through passthrough and response masking", async () => {
    const images = [{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "high" }, index: 3 }];
    const input = frame(chunk({ images })) + frame(chunk({}, "stop")) + "data: [DONE]\n\n";
    const output = await run(input, passthrough());
    const masked = await applyResponseMasking({ response: new Response(output, { headers: { "content-type": "text/event-stream" } }) }, { mode: "mask" });
    expect(parse(await masked.response.text()).find((event) => event.choices[0]?.delta.images)?.choices[0].delta.images).toEqual(images);
  });

  it("keeps Gemini generated images on the existing translation route", async () => {
    const input = frame({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }] }) + frame({ candidates: [{ finishReason: "STOP" }] });
    const output = await run(input, createSSETransformStreamWithLogger(FORMATS.GEMINI, FORMATS.OPENAI, "gemini", null, null, "test"));
    expect(parse(output).flatMap((event) => event.choices ?? []).flatMap((choice) => choice.delta?.images ?? [])).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }]);
  });
});
