import { describe, expect, it } from "vitest";
import { createSseParser } from "../../src/lib/playground/sse.js";

function collect() {
  const events = [];
  const parser = createSseParser((e) => events.push(e.data));
  return { events, parser };
}

describe("createSseParser", () => {
  it("emits one event per blank-line-separated block", () => {
    const { events, parser } = collect();
    parser.push('data: {"a":1}\n\n');
    parser.push('data: {"a":2}\n\n');
    expect(events).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("reassembles an event split across chunk boundaries", () => {
    const { events, parser } = collect();
    parser.push('data: {"hel');
    parser.push('lo":1}\n\n');
    expect(events).toEqual(['{"hello":1}']);
  });

  it("recognizes a CRLF delimiter split across pushes", () => {
    const { events, parser } = collect();
    parser.push('data: x\r');
    parser.push('\n\r\n');
    expect(events).toEqual(["x"]);
  });

  it("joins multiple data: lines of one event with \\n", () => {
    const { events, parser } = collect();
    parser.push("data: line1\ndata: line2\n\n");
    expect(events).toEqual(["line1\nline2"]);
  });

  it("strips one optional leading space after data:", () => {
    const { events, parser } = collect();
    parser.push("data: spaced\n\ndata:nospace\n\n");
    expect(events).toEqual(["spaced", "nospace"]);
  });

  it("skips [DONE] sentinel", () => {
    const { events, parser } = collect();
    parser.push('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(events).toEqual(['{"a":1}']);
  });

  it("ignores comment/heartbeat lines", () => {
    const { events, parser } = collect();
    parser.push(": heartbeat\n\ndata: ok\n\n");
    expect(events).toEqual(["ok"]);
  });

  it("flush() emits the trailing event without a final newline", () => {
    const { events, parser } = collect();
    parser.push('data: {"tail":true}');
    expect(events).toEqual([]);
    parser.flush();
    expect(events).toEqual(['{"tail":true}']);
  });

  it("flush() ignores whitespace-only remainder", () => {
    const { events, parser } = collect();
    parser.push('data: x\n\n');
    parser.push("   \n  ");
    parser.flush();
    expect(events).toEqual(["x"]);
  });
});
