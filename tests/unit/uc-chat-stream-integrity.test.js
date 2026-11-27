// Fork regressions against the staged OmniRoute c71f0065 UC port. Synthetic only.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { UcChatExecutor, UcFrameParser } from "../../open-sse/services/providerParity/native-uc-chat/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";

const delta = (text) => JSON.stringify({ message_type: "text", text });
const done = (raw_text) => JSON.stringify({ message_type: "text", end_of_stream: true, ...(raw_text === undefined ? {} : { raw_text }) });

// Deliberately independent of the original suites' socket/session fixtures.
function harness(messages) {
  const sockets = [];
  const sessions = { getSessionToken: vi.fn(async () => ({ ok: true, jwt: "SYNTHETIC-JWT-private" })), forget: vi.fn() };
  class Socket {
    constructor() {
      sockets.push(this);
      this.sent = [];
      queueMicrotask(async () => {
        this.onopen();
        for (const message of messages) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (this.closed) break;
          this.onmessage({ data: message });
        }
      });
    }
    on() {}
    send(frame) { this.sent.push(JSON.parse(frame)); }
    close() { this.closed = true; }
    terminate() { this.closed = true; }
  }
  const ex = new UcChatExecutor({ sessionController: sessions, env: { DURINDOOR_UC_CONSUMER_SIGNIN: "1" }, WebSocketImpl: Socket });
  const credentials = (tag) => ({ connectionId: tag, providerSpecificData: {
    ucUid: `0a1b2c3d-0000-4000-8000-00000000000${tag}`, ucSid: `sess_SYNTHETIC${tag}`,
    ucClientCookie: `SYNTHETIC-private-cookie-${tag}`, ucAuthSource: "email-code", ucSignedInAt: "2026-11-01T00:00:00Z",
  } });
  const onSuccess = vi.fn();
  const run = (stream, tag = "a", extra = {}) => ex.execute({ model: "claude-opus-47", body: { messages: [{ role: "user", content: "hello" }] }, stream, credentials: credentials(tag), onSuccess, ...extra });
  return { run, sockets, sessions, onSuccess };
}

async function readStream(response) {
  const wire = await response.text();
  const blocks = wire.split("\n\n").filter(Boolean);
  expect(blocks.pop()).toBe("data: [DONE]");
  return blocks.map((block) => JSON.parse(block.slice(6)));
}
function translated(chunks, format) {
  const state = initState(format);
  return [...chunks, null].flatMap((chunk) => translateResponse(FORMATS.OPENAI, format, chunk, state) || []).filter(Boolean);
}

describe("UC fragment integrity", () => {
  for (const text of ["Hello world", 'a \\"quote\\" \\ path\t雪😀', "  leading and trailing  ", "\n first\nsecond \n"]) {
    for (const raw of [false, true]) {
      it(`preserves every split of ${JSON.stringify(text)} (raw_text=${raw})`, () => {
        const frame = ` \t${delta(text)} \r`;
        const terminal = done(raw ? text : undefined);
        for (let split = 1; split < frame.length; split++) {
          const p = new UcFrameParser();
          const events = [...p.feed(frame.slice(0, split)), ...p.feed(frame.slice(split)), ...p.feed(terminal)];
          expect(events).toEqual([{ kind: "delta", text }, { kind: "done", text: text.trim() }]);
          expect(p.accumulated).toBe(text);
          expect(p.finalText()).toBe(text.trim());
          expect(p.carry).toBe("");
        }
        for (let split = 1; split < terminal.length; split++) {
          const p = new UcFrameParser();
          expect([...p.feed(delta(text)), ...p.feed(terminal.slice(0, split)), ...p.feed(terminal.slice(split))])
            .toEqual([{ kind: "delta", text }, { kind: "done", text: text.trim() }]);
        }
        const p = new UcFrameParser();
        const events = [...frame].flatMap((char) => p.feed(char));
        expect(events).toEqual([{ kind: "delta", text }]);
      });
    }
  }
  it("bounds original carry bytes and recovers from malformed keepalives", () => {
    const p = new UcFrameParser({ maxCarryBytes: 30 });
    expect(() => p.feed('{"text":"' + " ".repeat(31))).toThrow("carry-too-large");
    const q = new UcFrameParser();
    expect(q.feed("keepalive")).toEqual([]);
    expect(q.feed(delta("fine"))).toEqual([{ kind: "delta", text: "fine" }]);
    expect(q.feed(`bad json\n${done()}`)).toEqual([{ kind: "done", text: "fine" }]);
  });
});

describe("UC complete-answer classification", () => {
  it("cancels an accepted live turn without replay or a success ending", async () => {
    const h = harness([delta("real partial text"), done("real partial text")]);
    const abort = new AbortController();
    const result = await h.run(true, "a", { signal: abort.signal });
    const reader = result.response.body.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].closed).toBe(true);
    expect(h.sockets[0].sent).toHaveLength(1);
    expect(h.onSuccess).not.toHaveBeenCalled();
  });
  for (const stream of [false, true]) {
    it(`classifies a terminal-only capacity answer before output (stream=${stream})`, async () => {
      const h = harness([done("Model is temporarily unavailable")]);
      const result = await h.run(stream);
      expect(result.response.status).toBe(502);
      expect((await result.response.json()).error.code).toBe("uc_soft_error");
      expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "soft-error" });
      expect(h.sockets[0].sent).toHaveLength(1);
    });
  }

  for (const stream of [false, true]) {
    for (const raw of [false, true]) {
      for (const soft of [false, true]) {
        it(`${stream ? "streamed" : "buffered"} ${soft ? "capacity failure" : "ordinary answer"}, raw_text=${raw}`, async () => {
          const text = soft ? "Server overloaded temporarily. Please switch models and try again." : "An ordinary answer about server capacity.";
          const h = harness([delta(text.slice(0, 28)), delta(text.slice(28)), done(raw ? text : undefined)]);
          const result = await h.run(stream);
          if (!stream) {
            expect(result.response.status).toBe(soft ? 502 : 200);
            const body = await result.response.json();
            if (soft) {
              expect(body.error.code).toBe("uc_soft_error");
              expect(result.acceptedTurn).toEqual({ state: "accepted", outcome: "soft-error" });
              expect(body.usage).toBeUndefined();
            } else expect(body.choices[0].message.content).toBe(text);
          } else {
            expect(result.response.status).toBe(200);
            const events = await readStream(result.response);
            expect(events.map((e) => e.choices[0].delta.content || "").join("")).toBe(text);
            expect(events.filter((e) => e.choices[0].finish_reason).map((e) => e.choices[0].finish_reason)).toEqual([soft ? "error" : "stop"]);
            if (soft) {
              expect(events.at(-1).error.code).toBe("uc_soft_error");
              expect(events.some((e) => e.usage)).toBe(false);
              const claude = translated(events, FORMATS.CLAUDE);
              expect(claude.filter((e) => e.type === "error")).toHaveLength(1);
              expect(claude.some((e) => e.delta?.stop_reason)).toBe(false);
              const responses = translated(events, FORMATS.OPENAI_RESPONSES);
              expect(responses.map((e) => e.event).filter((e) => /^response\.(completed|failed|incomplete)$/.test(e))).toEqual(["response.failed"]);
            } else {
              expect(events.at(-1).usage.completion_tokens).toBe(Math.ceil(text.length / 4));
              expect(translated(events, FORMATS.CLAUDE).some((e) => e.delta?.stop_reason === "end_turn")).toBe(true);
              expect(translated(events, FORMATS.OPENAI_RESPONSES).some((e) => e.event === "response.completed")).toBe(true);
            }
          }
          expect(h.sockets).toHaveLength(1);
          expect(h.sockets[0].sent).toHaveLength(1);
          expect(h.sessions.forget).not.toHaveBeenCalled();
          expect(h.onSuccess).not.toHaveBeenCalled();
        });
      }
    }
  }
  it("redacts capacity diagnostics and isolates concurrent accounts without replay", async () => {
    const text = "Server overloaded temporarily SYNTHETIC-private-cookie-a SYNTHETIC-JWT-private";
    const h = harness([delta(text), done(text)]);
    const results = await Promise.all([h.run(true), h.run(false, "b")]);
    const events = await readStream(results[0].response);
    expect(JSON.stringify(events.at(-1))).not.toContain("SYNTHETIC");
    expect(JSON.stringify(await results[1].response.json())).not.toContain("SYNTHETIC-JWT-private");
    expect(h.sessions.getSessionToken.mock.calls.map(([c]) => c.connectionId).sort()).toEqual(["a", "b"]);
    expect(h.sockets.map((s) => s.sent.length)).toEqual([1, 1]);
    expect(h.sessions.forget).not.toHaveBeenCalled();
  });
});
