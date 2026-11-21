// OmniRoute #20836 (Playground part): errors embedded in a 200 stream and streams that close
// without content must surface in both the chat and compare flows. Offline fixtures only.
// Chat (PlaygroundPageClient) drains its stream with readChatStream + throwIfStreamFailed;
// compare (PlaygroundCompare -> streamCompletion) shares the same helpers.
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_STREAM_MESSAGE,
  STREAM_FAILED_MESSAGE,
  readChatStream,
  readStreamError,
  streamCompletion,
  throwIfStreamFailed,
} from "../../src/lib/playground/compare.js";

function sseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const content = (text) => ({ choices: [{ delta: { content: text } }] });

describe("readStreamError", () => {
  it("recognizes every in-band failure shape", () => {
    expect(readStreamError({ error: { message: "nope", type: "server_error" } })).toEqual({ message: "nope" });
    expect(readStreamError({ error: "plain text failure" })).toEqual({ message: "plain text failure" });
    expect(readStreamError({ type: "error", message: "top-level", error: { message: "nested" } })).toEqual({ message: "nested" });
    expect(readStreamError({ type: "error", message: "top-level only" })).toEqual({ message: "top-level only" });
    expect(readStreamError({ type: "response.failed", response: { error: { message: "failed turn" } } })).toEqual({ message: "failed turn" });
    expect(readStreamError({ error: {} })).toEqual({ message: null });
    expect(readStreamError({ type: "response.failed", response: {} })).toEqual({ message: null });
  });

  it("ignores ordinary frames", () => {
    expect(readStreamError(content("hi"))).toBeNull();
    expect(readStreamError({ choices: [], usage: { prompt_tokens: 1 } })).toBeNull();
    expect(readStreamError({ error: null, choices: [] })).toBeNull();
    expect(readStreamError({ error: "" })).toBeNull();
    expect(readStreamError(null)).toBeNull();
    expect(readStreamError("data")).toBeNull();
    expect(readStreamError([{ error: "x" }])).toBeNull();
  });
});

describe("chat flow (readChatStream + throwIfStreamFailed)", () => {
  const read = (events) => readChatStream(sseResponse(events).body.getReader());

  it("leaves a successful stream unchanged", async () => {
    const seen = [];
    const result = await readChatStream(sseResponse([content("Hel"), content("lo"), { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }, "[DONE]"]).body.getReader(), { onText: (t) => seen.push(t) });
    expect(result).toMatchObject({ text: "Hello", usage: { prompt_tokens: 3, completion_tokens: 2 }, streamError: null });
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(() => throwIfStreamFailed(result)).not.toThrow();
  });

  it("reports an error frame embedded in a 200 stream", async () => {
    const result = await read([{ choices: [], model: "keepalive" }, { error: { message: "No active credentials for provider: demo" } }, "[DONE]"]);
    expect(result.text).toBe("");
    expect(() => throwIfStreamFailed(result)).toThrow("No active credentials for provider: demo");
  });

  it("keeps text streamed before a mid-stream failure and still reports the failure", async () => {
    const seen = [];
    const result = await readChatStream(sseResponse([content("partial"), { error: { message: "upstream died" } }]).body.getReader(), { onText: (t) => seen.push(t) });
    expect(seen).toEqual(["partial"]);
    expect(() => throwIfStreamFailed(result)).toThrow("upstream died");
  });

  it("uses a generic message when the error frame carries no text, and sanitizes text", async () => {
    const empty = await read([{ error: {} }]);
    expect(() => throwIfStreamFailed(empty)).toThrow(STREAM_FAILED_MESSAGE);
    const markup = await read([{ error: { message: "<b>quota</b> at /srv/app/x.js" } }]);
    expect(() => throwIfStreamFailed(markup)).toThrow(/^quota at$/);
  });

  it("reports a stream that closes without content", async () => {
    for (const events of [[], ["[DONE]"], [{ choices: [], model: "keepalive" }, { choices: [], usage: { prompt_tokens: 1 } }, "[DONE]"]]) {
      const result = await read(events);
      expect(() => throwIfStreamFailed(result)).toThrow(EMPTY_STREAM_MESSAGE);
    }
  });
});

describe("compare flow (streamCompletion)", () => {
  it("resolves a successful stream exactly as before", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([content("ok"), { choices: [], usage: { completion_tokens: 1 } }, "[DONE]"]));
    const result = await streamCompletion({ fetchImpl, body: {} });
    expect(result.text).toBe("ok");
    expect(result.usage).toEqual({ completion_tokens: 1 });
  });

  it("rejects with the embedded error so the column shows Error, keeping streamed text", async () => {
    const seen = [];
    const fetchImpl = async () => sseResponse([content("half"), { error: { message: "boom" } }, "[DONE]"]);
    await expect(streamCompletion({ fetchImpl, body: {}, onText: (t) => seen.push(t) })).rejects.toThrow("boom");
    expect(seen).toEqual(["half"]);
  });

  it("rejects a stream that closes without content", async () => {
    const fetchImpl = async () => sseResponse([{ choices: [], model: "keepalive" }, "[DONE]"]);
    await expect(streamCompletion({ fetchImpl, body: {} })).rejects.toThrow(EMPTY_STREAM_MESSAGE);
  });
});
