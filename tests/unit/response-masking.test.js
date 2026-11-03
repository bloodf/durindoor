// #1479: opt-in PII / credential masking of provider responses, incl. streaming.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { applyResponseMasking, CARRY_CHARS, createIo, MAX_TOTAL_CARRY_CHARS } from "../../open-sse/services/responseMasking.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null), isNativePassthrough: vi.fn(() => false), isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestUsage: vi.fn(() => Promise.resolve()), appendRequestLog: vi.fn(() => Promise.resolve()), saveRequestDetail: vi.fn(() => Promise.resolve()),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const KEY = "sk-ant-api03-" + "A".repeat(40);
const ARGS = JSON.stringify({ to: "ops@example.com", token: KEY });
const MASK = { mode: "mask" };

const jsonResult = (body) => ({ success: true, response: new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) });
const sseResult = (chunks, { error } = {}) => {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else if (error) c.error(error);
      else c.close();
    },
  });
  return { success: true, response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) };
};
const frame = (payload, event) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;
const payloads = (text) => text.split(/\n\n/).map((f) => f.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
  .filter((d) => d && d !== "[DONE]").map((d) => JSON.parse(d));
const logger = () => ({ warn: vi.fn() });
const logged = (log) => log.warn.mock.calls.map((c) => c.join(" ")).join("\n");
// Split a string into two SSE chunks in the middle of KEY.
const splitAt = (s) => [s.slice(0, s.indexOf(KEY) + 20), s.slice(s.indexOf(KEY) + 20)];

describe("off and warn modes", () => {
  it("off returns the same result object, so bytes are untouched", async () => {
    const result = sseResult([frame({ choices: [{ index: 0, delta: { content: KEY } }] })]);
    expect(await applyResponseMasking(result, null)).toBe(result);
    expect(await applyResponseMasking(result, { mode: "off" })).toBe(result);
  });

  it("warn keeps JSON bytes identical and logs counts only", async () => {
    const raw = `{"choices" : [ {"message": {"content": "key ${KEY} \\u00e9 a@b.co"}} ]}`;
    const log = logger();
    const out = await applyResponseMasking(jsonResult(raw), { mode: "warn" }, log);
    expect(await out.response.text()).toBe(raw);
    expect(logged(log)).toMatch(/MASKING response detected 2 \(anthropic:1,email:1\)/);
    expect(logged(log)).not.toContain(KEY.slice(0, 15));
  });

  it("warn keeps a split SSE stream byte-identical and counts across chunks", async () => {
    const raw = frame({ choices: [{ index: 0, delta: { content: `x ${KEY.slice(0, 20)}` } }] }) +
      frame({ choices: [{ index: 0, delta: { content: `${KEY.slice(20)} y` }, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
    const chunks = [raw.slice(0, 37), raw.slice(37, 90), raw.slice(90)];
    const log = logger();
    const out = await applyResponseMasking(sseResult(chunks), { mode: "warn" }, log);
    expect(await out.response.text()).toBe(raw);
    expect(logged(log)).toMatch(/response detected 1 \(anthropic:1\)/);
  });
});

describe("mask mode, non-streaming", () => {
  it("masks Chat text and never tool calls", async () => {
    const body = { choices: [{ index: 0, message: { role: "assistant", content: `key ${KEY}`, tool_calls: [{ id: "call_a@b.co", type: "function", function: { name: "send", arguments: ARGS } }] } }] };
    const log = logger();
    const out = JSON.parse(await (await applyResponseMasking(jsonResult(body), MASK, log)).response.text());
    expect(out.choices[0].message.content).toBe("key [REDACTED:anthropic]");
    expect(out.choices[0].message.tool_calls).toEqual(body.choices[0].message.tool_calls);
    expect(logged(log)).toMatch(/response masked 1 \(anthropic:1\)/);
  });

  it("masks Responses, Claude and Gemini text only", async () => {
    const responses = { object: "response", output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "a@b.co" }] },
      { type: "message", content: [{ type: "output_text", text: `mail a@b.co` }] },
      { type: "function_call", call_id: "call_a@b.co", name: "send", arguments: ARGS },
    ] };
    const r = JSON.parse(await (await applyResponseMasking(jsonResult(responses), MASK)).response.text());
    expect(r.output[1].content[0].text).toBe("mail [EMAIL_REDACTED]");
    expect(r.output[0]).toEqual(responses.output[0]);
    expect(r.output[2]).toEqual(responses.output[2]);

    const claude = { type: "message", content: [
      { type: "thinking", thinking: KEY, signature: "sig" },
      { type: "text", text: KEY },
      { type: "tool_use", id: "toolu_1", name: "send", input: { token: KEY } },
    ] };
    const c = JSON.parse(await (await applyResponseMasking(jsonResult(claude), MASK)).response.text());
    expect(c.content[1].text).toBe("[REDACTED:anthropic]");
    expect(c.content[0]).toEqual(claude.content[0]);
    expect(c.content[2]).toEqual(claude.content[2]);

    const gemini = { response: { candidates: [{ content: { parts: [
      { text: KEY, thought: true }, { text: `t ${KEY}` }, { functionCall: { name: "send", args: { token: KEY } } },
    ] } }] } };
    const g = JSON.parse(await (await applyResponseMasking(jsonResult(gemini), MASK)).response.text());
    const parts = g.response.candidates[0].content.parts;
    expect(parts[1].text).toBe("t [REDACTED:anthropic]");
    expect(parts[0]).toEqual(gemini.response.candidates[0].content.parts[0]);
    expect(parts[2]).toEqual(gemini.response.candidates[0].content.parts[2]);
  });

  it("leaves bodies with nothing to mask byte-identical", async () => {
    const raw = `{"choices":[{"message":{"content":"hi \\u00e9"}}]}`;
    expect(await (await applyResponseMasking(jsonResult(raw), MASK)).response.text()).toBe(raw);
  });
});

describe("mask mode, streaming", () => {
  it("masks a Chat secret split across two SSE chunks and keeps tool calls intact", async () => {
    const tool = { index: 0, id: "call_1", type: "function", function: { name: "send", arguments: ARGS } };
    const raw = frame({ choices: [{ index: 0, delta: { content: `my key ${KEY.slice(0, 20)}` } }] }) +
      frame({ choices: [{ index: 0, delta: { content: `${KEY.slice(20)} ok` } }] }) +
      frame({ choices: [{ index: 0, delta: { tool_calls: [tool] } }] }) +
      frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n";
    const text = await (await applyResponseMasking(sseResult(splitAt(raw)), MASK)).response.text();
    const events = payloads(text);
    const content = events.map((p) => p.choices[0].delta.content ?? "").join("");
    expect(content).toBe("my key [REDACTED:anthropic] ok");
    expect(text).not.toContain(`key ${KEY.slice(0, 20)}`);
    const toolIdx = events.findIndex((p) => p.choices[0].delta.tool_calls);
    expect(events[toolIdx].choices[0].delta.tool_calls).toEqual([tool]);
    expect(events.slice(toolIdx).every((p) => !p.choices[0].delta.content)).toBe(true);
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("masks Responses deltas and reuses the sent text in done events and the snapshot", async () => {
    const call = { type: "function_call", id: "fc_1", call_id: "call_a@b.co", name: "send", arguments: ARGS };
    const full = `see ${KEY} end`;
    const raw = [
      frame({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: full.slice(0, 15) }, "response.output_text.delta"),
      frame({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: full.slice(15) }, "response.output_text.delta"),
      frame({ type: "response.output_text.done", output_index: 0, content_index: 0, text: full }, "response.output_text.done"),
      frame({ type: "response.content_part.done", output_index: 0, content_index: 0, part: { type: "output_text", text: full } }),
      frame({ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: full }] } }),
      frame({ type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: ARGS }),
      frame({ type: "response.output_item.done", output_index: 1, item: call }),
      frame({ type: "response.completed", response: { object: "response", output: [{ type: "message", content: [{ type: "output_text", text: full }] }, call] } }),
    ].join("");
    const text = await (await applyResponseMasking(sseResult(splitAt(raw)), MASK)).response.text();
    const events = payloads(text);
    const sent = events.filter((p) => p.type === "response.output_text.delta").map((p) => p.delta).join("");
    expect(sent).toBe("see [REDACTED:anthropic] end");
    expect(events.find((p) => p.type === "response.output_text.done").text).toBe(sent);
    expect(events.find((p) => p.type === "response.content_part.done").part.text).toBe(sent);
    expect(events.find((p) => p.type === "response.output_item.done").item.content[0].text).toBe(sent);
    const completed = events.find((p) => p.type === "response.completed");
    expect(completed.response.output[0].content[0].text).toBe(sent);
    expect(completed.response.output[1]).toEqual(call);
    expect(events.find((p) => p.type === "response.function_call_arguments.delta").delta).toBe(ARGS);
    expect(events.filter((p) => p.type === "response.output_item.done")[1].item).toEqual(call);
    expect(text).toContain("event: response.output_text.delta\n");
  });

  it("masks Claude text deltas, flushes before content_block_stop, and keeps tool input", async () => {
    const raw = [
      frame({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: KEY } }, "content_block_delta"),
      frame({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: `k ${KEY.slice(0, 20)}` } }, "content_block_delta"),
      frame({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: KEY.slice(20) } }, "content_block_delta"),
      frame({ type: "content_block_stop", index: 1 }, "content_block_stop"),
      frame({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: ARGS } }, "content_block_delta"),
      frame({ type: "message_stop" }, "message_stop"),
    ].join("");
    const text = await (await applyResponseMasking(sseResult(splitAt(raw)), MASK)).response.text();
    const events = payloads(text);
    const stop = events.findIndex((p) => p.type === "content_block_stop");
    const before = events.slice(0, stop).filter((p) => p.delta?.type === "text_delta").map((p) => p.delta.text).join("");
    expect(before).toBe("k [REDACTED:anthropic]");
    expect(events[0].delta.thinking).toBe(KEY);
    expect(events.find((p) => p.delta?.type === "input_json_delta").delta.partial_json).toBe(ARGS);
    expect(text.split("\n\n").filter(Boolean).every((f) => f.startsWith("event: "))).toBe(true);
  });

  it("masks a Gemini secret split across chunks and flushes on finishReason", async () => {
    const chunk = (parts, finishReason) => frame({ response: { candidates: [{ content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }] } });
    const raw = chunk([{ text: `g ${KEY.slice(0, 20)}` }]) + chunk([{ text: KEY.slice(20) }]) +
      chunk([{ functionCall: { name: "send", args: { token: KEY } } }], "STOP");
    const text = await (await applyResponseMasking(sseResult(splitAt(raw)), MASK)).response.text();
    const parts = payloads(text).flatMap((p) => p.response.candidates[0].content.parts);
    expect(parts.filter((p) => "text" in p).map((p) => p.text).join("")).toBe("g [REDACTED:anthropic]");
    const callAt = parts.findIndex((p) => p.functionCall);
    expect(parts[callAt].functionCall.args.token).toBe(KEY);
    expect(parts.slice(callAt + 1).some((p) => p.text)).toBe(false);
  });

  it("bounds the carry: held text never exceeds CARRY_CHARS for plain prose", async () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i} `);
    const raw = words.map((w) => frame({ choices: [{ index: 0, delta: { content: w } }] })).join("");
    const out = (await applyResponseMasking(sseResult([raw]), MASK)).response.body.getReader();
    const dec = new TextDecoder();
    let sent = "";
    for (;;) {
      const { value, done } = await out.read();
      if (done) break;
      const got = payloads(dec.decode(value)).map((p) => p.choices[0].delta.content).join("");
      sent += got;
    }
    expect(sent).toBe(words.join(""));
    // First output arrives before the stream ends: only the last CARRY_CHARS wait.
    const first = await (await applyResponseMasking(sseResult([raw.slice(0, raw.length / 2), raw.slice(raw.length / 2)]), MASK)).response.body.getReader().read();
    expect(payloads(dec.decode(first.value)).map((p) => p.choices[0].delta.content).join("").length).toBeGreaterThanOrEqual(words.slice(0, 100).join("").length - CARRY_CHARS);
  });

  it("flushes the masked carry at stream end and when the upstream errors", async () => {
    const delta = frame({ choices: [{ index: 0, delta: { content: `tail ${KEY}` } }] });
    const ended = await (await applyResponseMasking(sseResult([delta]), MASK)).response.text();
    expect(payloads(ended).map((p) => p.choices[0].delta.content).join("")).toBe("tail [REDACTED:anthropic]");

    const reader = (await applyResponseMasking(sseResult([delta], { error: new Error("upstream reset") }), MASK)).response.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    await expect((async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += dec.decode(value);
      }
    })()).rejects.toThrow("upstream reset");
    expect(payloads(text).map((p) => p.choices[0].delta.content).join("")).toBe("tail [REDACTED:anthropic]");
    expect(text).not.toContain(KEY);
  });
});

describe("carry bounds and stream integrity", () => {
  const OPTS = { credentials: true, pii: true };

  it("never splits a UTF-16 surrogate pair across deltas", async () => {
    // The 128-char cut lands between the two halves of the emoji.
    const content = "x".repeat(10) + "\u{1F600}" + "y".repeat(CARRY_CHARS - 1);
    const raw = frame({ choices: [{ index: 0, delta: { content } }] }) + frame({ choices: [{ index: 0, delta: { content: "z" } }] });
    const text = await (await applyResponseMasking(sseResult([raw]), MASK)).response.text();
    const deltas = payloads(text).map((p) => p.choices[0].delta.content);
    expect(deltas.join("")).toBe(content + "z");
    for (const d of deltas) {
      expect(d).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(d).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(text).not.toMatch(/\\ud83d"/i);
  });

  it("warn mode scans in windows and drops text once scanned", () => {
    const counts = {};
    const io = createIo({ ...OPTS, replace: false }, counts, false);
    io.wrap = (p) => p;
    const pieces = Array.from({ length: 5000 }, (_, i) => `chunk ${i} of plain prose. `);
    pieces.splice(2500, 0, `key ${KEY.slice(0, 20)}`, `${KEY.slice(20)} done `);
    let maxHeld = 0;
    for (const piece of pieces) {
      expect(io.feed("chat/0/", piece, (t) => ({ t }))).toBe(piece);
      maxHeld = Math.max(maxHeld, io.held());
    }
    io.flush("");
    expect(maxHeld).toBeLessThanOrEqual(CARRY_CHARS + 64);
    expect(io.held()).toBe(0);
    expect(counts).toEqual({ anthropic: 1 });
  });

  it("mask mode caps the total carry across indexes", () => {
    const io = createIo({ ...OPTS, replace: true }, {}, true);
    io.wrap = (p) => p;
    // An unterminated private key block holds each index (below its own cap).
    const block = "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(20000);
    for (let i = 0; i < 10; i++) io.feed(`claude/${i}/`, block, (t) => ({ t }));
    expect(io.held()).toBeLessThanOrEqual(MAX_TOTAL_CARRY_CHARS + 10 * CARRY_CHARS);
  });

  it("keeps sent text only for Responses keys", () => {
    const io = createIo({ ...OPTS, replace: true }, {}, true);
    io.wrap = (p) => p;
    for (const key of ["chat/0/", "claude/0/", "gem/0/", "resp/0/0/"]) io.feed(key, "x".repeat(400), (t) => ({ t }));
    expect(io.emittedKeys()).toEqual(["resp/0/0/"]);
  });

  it("gives synthesized Responses deltas their own sequence numbers", async () => {
    const full = `seq ${KEY} end`;
    const ev = (n, p) => frame({ ...p, sequence_number: n }, p.type);
    const raw = [
      ev(0, { type: "response.created", response: { object: "response", output: [] } }),
      ev(1, { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: full }),
      ev(2, { type: "response.output_text.done", output_index: 0, content_index: 0, text: full }),
      ev(3, { type: "response.completed", response: { object: "response", output: [{ type: "message", content: [{ type: "output_text", text: full }] }] } }),
    ].join("");
    const events = payloads(await (await applyResponseMasking(sseResult([raw]), MASK)).response.text());
    expect(events.map((p) => p.sequence_number)).toEqual(events.map((_, i) => i));
    expect(events.filter((p) => p.type === "response.output_text.delta").map((p) => p.delta).join("")).toBe("seq [REDACTED:anthropic] end");
  });
});

describe("chatCore wiring", () => {
  const upstream = frame({ id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-4o", choices: [{ index: 0, delta: { role: "assistant", content: `here ${KEY.slice(0, 20)}` }, finish_reason: null }] }) +
    frame({ id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-4o", choices: [{ index: 0, delta: { content: KEY.slice(20) }, finish_reason: null }] }) +
    frame({ id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-4o", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockImplementation(async () => ({
      response: sseResult(splitAt(upstream)).response, url: "https://example.test", headers: {}, transformedBody: null,
    }));
  });
  const run = async (contentMasking, stream) => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() };
    const body = () => ({ model: "m", messages: [{ role: "user", content: "hi" }], stream });
    const result = await handleChatCore({
      body: body(), modelInfo: { provider: "openai", model: "gpt-4o" }, credentials: { apiKey: "k", providerSpecificData: {} },
      log, connectionId: "c", contentMasking,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: body(), headers: { accept: stream ? "text/event-stream" : "application/json" } },
    });
    // The SSE path mints a fresh chatcmpl id and a timing-based rate per request; everything else must match.
    const text = (await result.response.text()).replace(/chatcmpl-[A-Za-z0-9]+/g, "chatcmpl-ID").replace(/,"tokens_per_second":[\d.]+/g, "");
    return { text, log };
  };

  it("masks streamed and JSON client responses in mask mode and logs counts only", async () => {
    const streamed = await run({ mode: "mask" }, true);
    expect(payloads(streamed.text).map((p) => p.choices?.[0]?.delta?.content ?? "").join("")).toBe("here [REDACTED:anthropic]");
    expect(logged(streamed.log)).toMatch(/MASKING response masked 1 \(anthropic:1\)/);
    expect(logged(streamed.log)).not.toContain(KEY.slice(0, 15));
    const json = await run({ mode: "mask" }, false);
    expect(JSON.parse(json.text).choices[0].message.content).toBe("here [REDACTED:anthropic]");
  });

  it("off and warn return byte-identical client responses", async () => {
    for (const stream of [true, false]) {
      const off = (await run(null, stream)).text;
      expect(off).toContain(stream ? KEY.slice(20) : KEY);
      expect((await run({ mode: "off" }, stream)).text).toBe(off);
      const warned = await run({ mode: "warn" }, stream);
      expect(warned.text).toBe(off);
      expect(logged(warned.log)).toMatch(/MASKING response detected 1 /);
    }
  });
});
