// Fork regressions for the staged OmniRoute UC stream.ts/ws.ts port. Mocked only.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { UcFrameParser } from "../../open-sse/services/providerParity/native-uc-chat/stream.js";
import { runUcTurn } from "../../open-sse/services/providerParity/native-uc-chat/ws.js";

const text = '  first\n雪😀 "quote" \\ path\t last  ';
const delta = JSON.stringify({ message_type: "text", text });
const done = JSON.stringify({ message_type: "text", end_of_stream: true });

function socketHarness() {
  const sockets = [];
  class Socket {
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen()); }
    send() { this.sends = (this.sends || 0) + 1; }
    close() { this.closed = true; }
    terminate() { this.closed = true; }
    message(data) { this.onmessage({ data }); }
  }
  return { sockets, start: (extra = {}) => runUcTurn({ url: "wss://synthetic.invalid", frame: {}, WebSocketImpl: Socket, ...extra }) };
}

describe("UC keepalive followed by fragmented JSON", () => {
  for (const delimiter of ["", "\n", "\r\n", "\r"]) {
    it(`preserves every split after keepalive ${JSON.stringify(delimiter)}`, () => {
      for (let split = 1; split < delta.length; split++) {
        const p = new UcFrameParser();
        const events = [
          ...p.feed(`keepalive${delimiter}`), ...p.feed(delta.slice(0, split)),
          ...p.feed(delta.slice(split)), ...p.feed(done),
        ];
        expect(events).toEqual([{ kind: "delta", text }, { kind: "done", text: text.trim() }]);
        expect(p.accumulated).toBe(text);
        expect(p.carry).toBe("");
      }
    });
  }
  it("preserves whitespace and escapes through one-character messages after repeated keepalives", () => {
    const p = new UcFrameParser();
    p.feed("keepalive");
    p.feed("ping");
    const events = (` \t${delta}\r\n${done}`).split("").flatMap((char) => p.feed(char));
    expect(events).toEqual([{ kind: "delta", text }, { kind: "done", text: text.trim() }]);
  });
  it("still bounds retained JSON and keepalive bytes", () => {
    const p = new UcFrameParser({ maxCarryBytes: 40 });
    p.feed("keepalive");
    expect(() => p.feed('{"text":"' + " ".repeat(41))).toThrow("carry-too-large");
    expect(() => new UcFrameParser({ maxCarryBytes: 4 }).feed("keepalive")).toThrow("carry-too-large");
  });
  for (const keepalive of [false, true]) {
    for (const kind of ["buffer", "arraybuffer", "view", "fragments"]) {
      it(`decodes Unicode across binary messages (${kind}, keepalive=${keepalive})`, async () => {
        const h = socketHarness();
        const events = [];
        const result = h.start({ onEvent: (e) => events.push(e) });
        await Promise.resolve();
        const socket = h.sockets[0];
        if (keepalive) socket.message("keepalive");
        const bytes = Buffer.from(`${delta}\n${done}`);
        for (const byte of bytes) {
          const b = Buffer.from([byte]);
          const data = kind === "buffer" ? b : kind === "arraybuffer" ? Uint8Array.of(byte).buffer
            : kind === "view" ? new Uint8Array([0, byte, 0]).subarray(1, 2) : [b.subarray(0, 0), b];
          socket.message(data);
        }
        expect(await result).toMatchObject({ outcome: "complete", content: text.trim(), sent: true });
        expect(events).toEqual([{ kind: "delta", text }, { kind: "done", text: text.trim() }]);
        expect(socket.sends).toBe(1);
        expect(socket.closed).toBe(true);
      });
    }
  }
  it("cancels with a pending fragment and ignores later completion without replay", async () => {
    const h = socketHarness();
    const abort = new AbortController();
    const events = [];
    const result = h.start({ signal: abort.signal, onEvent: (e) => events.push(e) });
    await Promise.resolve();
    const socket = h.sockets[0];
    socket.message("keepalive");
    socket.message(delta.slice(0, 20));
    abort.abort();
    socket.message(delta.slice(20));
    socket.message(done);
    expect(await result).toMatchObject({ outcome: "aborted", content: "", sent: true });
    expect(events).toEqual([]);
    expect(socket.sends).toBe(1);
    expect(socket.closed).toBe(true);
    expect(h.sockets).toHaveLength(1);
  });
});
