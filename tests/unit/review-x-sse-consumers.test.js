// Issue 2254: every SSE consumer must read the same events from the same frames.
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";
import { handleMusicGenerationCore } from "../../open-sse/handlers/musicGenerationCore.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { mapInteractionEvents } from "../../open-sse/utils/interactionEvents.js";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

const { createRealtimeSession } = createRequire(import.meta.url)("../../open-sse/handlers/realtimeCore.js");
const encoder = new TextEncoder();

// One payload shape that every consumer understands.
const FIRST = {
  type: "response.image_generation_call.partial_image",
  partial_image_b64: "one",
  choices: [{ index: 0, delta: { content: "one" }, finish_reason: null }],
};
const LAST = {
  type: "response.completed",
  response: { status: "completed", output: [{ type: "image_generation_call", result: "two" }] },
  data: { status: 2 },
  extra_info: { music_duration: 2000 },
  choices: [{ index: 0, delta: { content: "two" }, finish_reason: "stop" }],
};
const IGNORED = JSON.stringify({ choices: [{ index: 0, delta: { content: "ignored" } }] });

const one = (event) => JSON.stringify(event);
// Splits the JSON so that one continuation line is itself a complete object.
const split = (event) => {
  const element = one(event.choices[0]);
  const [head, tail] = one(event).split(element);
  return [head, element, tail];
};
const frames = (eol, prefix = "data: ", lines = (event) => [one(event)]) =>
  [lines(FIRST), lines(LAST), ["[DONE]"]]
    .map((payload) => payload.map((line) => `${prefix}${line}${eol}`).join("") + eol)
    .join("");

const TABLE = [
  ["LF", frames("\n")],
  ["CRLF", frames("\r\n")],
  ["CR", frames("\r")],
  ["data: without a space", frames("\n", "data:")],
  ["data: with extra spaces", frames("\n", "data:   ")],
  ["multi-line data", frames("\n", "data: ", split)],
  ["multi-line data with CR", frames("\r", "data:", split)],
  ["comments and an indented field", `: ping\n\n data: ${IGNORED}\n: ping\n\n${frames("\n")}: ping\n\n`],
  ["blank data keepalives", `data:\n\ndata:   \n\n${frames("\n")}`],
  ["trailing event without a blank line", `data: ${one(FIRST)}\n\ndata: ${one(LAST)}`, { truncated: true, done: false }],
  ["trailing [DONE] without a blank line", frames("\n").trimEnd(), { truncated: true }],
];

const body = (wire, size) => new ReadableStream({
  start(controller) {
    const bytes = encoder.encode(wire);
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  },
});

async function realtimeDeltas(wire, size) {
  const sent = [];
  const ws = { OPEN: 1, readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  const { handleClientEvent } = createRealtimeSession({
    ws,
    session: { model: "m", items: [{ type: "message", role: "user", content: "hi" }] },
    chat: async () => new Response(body(wire, size), { headers: { "content-type": "text/event-stream" } }),
  });
  await handleClientEvent(JSON.stringify({ type: "response.create" }));
  return sent.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta);
}

async function codexImages(wire, size) {
  const { sseResponse } = await codex.parseResponse(new Response(body(wire, size)), { streamToClient: true });
  const text = await sseResponse.text();
  return [...text.matchAll(/"b64_json":"(\w+)"/g)].map((match) => match[1]);
}

async function musicCompletions(wire, size) {
  const restore = __setOriginalFetchForTesting(vi.fn(async () =>
    new Response(body(wire, size), { headers: { "content-type": "text/event-stream" } })));
  const onComplete = vi.fn();
  try {
    const result = await handleMusicGenerationCore({
      provider: "minimax", model: "music-3.0", body: { prompt: "song" }, credentials: { apiKey: "key" }, onComplete,
    });
    expect(await result.response.text()).toBe(wire);
    return onComplete.mock.calls.map(([accounting]) => accounting.nativeUnits.audioSeconds);
  } finally {
    restore();
  }
}

async function interactionContents(wire, size) {
  const mapped = mapInteractionEvents(body(wire, size), (event) => `${event?.choices[0].delta.content},`);
  return (await new Response(mapped).text()).split(",").filter(Boolean);
}

async function ollamaContents(wire, size) {
  const text = await transformToOllama(new Response(body(wire, size)), "m").text();
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.filter((line) => line.done)).toHaveLength(1);
  return lines.map((line) => line.message.content).filter(Boolean);
}

describe.each(TABLE)("SSE consumers: %s", (_name, wire, { truncated = false, done = true } = {}) => {
  // Byte-at-a-time delivery splits every CRLF and field name; the large size is one chunk.
  describe.each([1, 3, 1 << 20])("chunk size %i", (size) => {
    it("interaction events", async () => {
      expect(await interactionContents(wire, size)).toEqual(["one", "two"]);
    });
    it("Ollama transform", async () => {
      expect(await ollamaContents(wire, size)).toEqual(["one", "two"]);
    });
    it("realtime bridge", async () => {
      expect(await realtimeDeltas(wire, size)).toEqual(["one", "two"]);
    });
    it("Codex images", async () => {
      expect(await codexImages(wire, size)).toEqual(["one", "two"]);
    });
    it("music accounting", async () => {
      // An unterminated tail is deliberately not a successful music terminal.
      expect(await musicCompletions(wire, size)).toEqual(truncated ? [] : [2]);
    });
    it("forced SSE to JSON", () => {
      // A Chat stream without [DONE] is not a coherent completion, however it is framed.
      const completion = parseSSEToOpenAIResponse(wire, "m");
      expect(completion?.choices[0].message.content).toBe(done ? "onetwo" : undefined);
    });
  });
});

describe("SSE consumer edge cases", () => {
  it("stops the realtime bridge at a [DONE] with extra spaces", async () => {
    expect(await realtimeDeltas(`data: ${one(FIRST)}\n\ndata:   [DONE]\n\ndata: ${one(LAST)}\n\n`, 3)).toEqual(["one"]);
  });

  it("delivers an Ollama chunk from a CR-only stream before the upstream closes", async () => {
    let upstream;
    const source = new ReadableStream({ start(controller) { upstream = controller; } });
    const reader = transformToOllama(new Response(source), "m").body.getReader();
    let timer;
    try {
      upstream.enqueue(encoder.encode(`data: ${one(FIRST)}\r`));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("chunk was held")), 1000);
      });
      const { value } = await Promise.race([reader.read(), timeout]);
      expect(JSON.parse(new TextDecoder().decode(value)).message.content).toBe("one");
    } finally {
      clearTimeout(timer);
      await reader.cancel();
    }
  });
});
