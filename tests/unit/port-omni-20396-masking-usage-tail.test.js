// OmniRoute #20396: usage metadata strings are masked in place and never cost the reply its tail.
import { describe, expect, it } from "vitest";
import { applyResponseMasking } from "../../open-sse/services/responseMasking.js";

const KEY = "sk-ant-api03-" + "A".repeat(40);
const KEY_BODY = "SYNTHETICKEYBODY".repeat(4);
const OPEN_KEY = `source -----BEGIN PRIVATE KEY-----\n${KEY_BODY}`;
const REPLY = "x".repeat(520);
const MASK = { mode: "mask" };

const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const run = async (body, contentType, config = MASK) => {
  const result = { success: true, response: new Response(body, { headers: { "content-type": contentType } }) };
  return (await applyResponseMasking(result, config)).response.text();
};
const payloads = (text) => text.split("\n\n").map((f) => f.slice(6)).filter((d) => d && d !== "[DONE]").map((d) => JSON.parse(d));
const reply = (usage) => [
  frame({ choices: [{ index: 0, delta: { content: REPLY } }] }),
  frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage }),
  "data: [DONE]\n\n",
].join("");
const visible = (chunks) => chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("");

describe("port(omniroute): #20396 masking keeps the reply tail and covers usage metadata", () => {
  it("delivers the whole reply once and keeps clean usage strings", async () => {
    const usage = { prompt_tokens: 3, details: { prompt_source: "native", completion_source: "native" } };
    const chunks = payloads(await run(reply(usage), "text/event-stream"));
    expect(visible(chunks)).toBe(REPLY);
    expect(chunks.at(-1).usage).toEqual(usage);
  });

  it("masks a credential in nested usage without moving it into the reply", async () => {
    const chunks = payloads(await run(reply({ details: { notes: [KEY] }, total_tokens: 5 }), "text/event-stream"));
    expect(visible(chunks)).toBe(REPLY);
    expect(chunks.at(-1).usage).toEqual({ details: { notes: ["[REDACTED:anthropic]"] }, total_tokens: 5 });
  });

  it("redacts an unclosed private-key block in usage to its end", async () => {
    const text = await run(reply({ details: { source: OPEN_KEY } }), "text/event-stream");
    expect(text).not.toContain(KEY_BODY);
    expect(payloads(text).at(-1).usage.details.source).toBe("source [REDACTED:private_key]");
  });

  it("masks usage strings in a buffered JSON reply", async () => {
    const body = JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { source: OPEN_KEY, note: KEY } });
    const parsed = JSON.parse(await run(body, "application/json"));
    expect(parsed.usage).toEqual({ source: "source [REDACTED:private_key]", note: "[REDACTED:anthropic]" });
  });

  it("leaves usage bytes alone in warn mode and when credential masking is off", async () => {
    const stream = reply({ source: OPEN_KEY });
    expect(await run(stream, "text/event-stream", { mode: "warn" })).toBe(stream);
    const unmasked = payloads(await run(stream, "text/event-stream", { mode: "mask", credentials: false }));
    expect(unmasked.at(-1).usage.source).toBe(OPEN_KEY);
  });
});
