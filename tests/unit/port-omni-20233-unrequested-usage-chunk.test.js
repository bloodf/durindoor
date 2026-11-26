import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const REAL = { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 };
const base = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m" };
const content = { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] };
const finish = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
const usageOnly = { ...base, choices: [], usage: REAL };
const asked = { stream: true, messages: [{ role: "user", content: "hi" }], stream_options: { include_usage: true } };
const silent = { stream: true, messages: [{ role: "user", content: "hi" }] };

async function run(chunks, { body, providerBody = asked, translate = false, tail = "data: [DONE]\n\n" }) {
  let recorded;
  const onComplete = (_content, usage) => { recorded = usage; };
  const transform = translate
    ? createSSETransformStreamWithLogger("openai", "openai", "openrouter", null, null, "m", null, body, onComplete, null, "off", null, providerBody)
    : createPassthroughStreamWithLogger("openrouter", null, null, "m", null, body, onComplete, null, "openai", null, providerBody);
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + tail;
  const out = await new Response(new Response(text).body.pipeThrough(transform)).text();
  const events = out.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  return { events, recorded };
}

describe("OmniRoute #20233: no unrequested usage-only chunk for Chat clients", () => {
  it.each([["passthrough", false], ["same-format translate", true]])("%s drops the chunk and still records usage", async (_name, translate) => {
    const { events, recorded } = await run([content, finish, usageOnly], { body: silent, translate });
    expect(events.filter((event) => event.choices?.length === 0)).toEqual([]);
    expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(true);
    expect(recorded.prompt_tokens).toBe(REAL.prompt_tokens);
  });

  it("drops an unterminated final usage-only frame and records it", async () => {
    const { events, recorded } = await run([content, finish], { body: silent, tail: `data: ${JSON.stringify(usageOnly)}` });
    expect(events.filter((event) => event.choices?.length === 0)).toEqual([]);
    expect(recorded.prompt_tokens).toBe(REAL.prompt_tokens);
  });

  it("sends no estimated usage chunk either, and still records the estimate", async () => {
    const { events, recorded } = await run([content, finish], { body: silent });
    expect(events.filter((event) => event.choices?.length === 0)).toEqual([]);
    expect(recorded.completion_tokens).toBeGreaterThan(0);
  });

  it("keeps the chunk for a client that asks for usage", async () => {
    const { events } = await run([content, finish, usageOnly], { body: asked });
    expect(events.filter((event) => event.choices?.length === 0)).toHaveLength(1);
  });

  it("keeps requested usage on the final passthrough event", async () => {
    const { events, recorded } = await run([content, finish, usageOnly], { body: asked });
    const last = events.at(-1);
    // Prompt tokens may carry the router's buffer, so compare the untouched completion count.
    expect(last.usage.completion_tokens).toBe(REAL.completion_tokens);
    expect(last.usage.total_tokens).toBe(last.usage.prompt_tokens + last.usage.completion_tokens);
    expect(recorded.completion_tokens).toBe(REAL.completion_tokens);
    expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(true);
  });

  it("keeps an upstream chunk the router did not ask for", async () => {
    const { events } = await run([content, finish, usageOnly], { body: silent, providerBody: silent });
    expect(events.filter((event) => event.choices?.length === 0)).toHaveLength(1);
  });
});

describe("OmniRoute #20233: bridges that read usage ask for it", () => {
  it("the Gemini v1beta bridge requests usage for streams only", async () => {
    const { convertGeminiToInternal } = await import("../../src/app/api/v1beta/models/[...path]/geminiBridge.js");
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    expect(convertGeminiToInternal(body, "m", true).stream_options).toEqual({ include_usage: true });
    expect(convertGeminiToInternal(body, "m", false)).not.toHaveProperty("stream_options");
  });
});
