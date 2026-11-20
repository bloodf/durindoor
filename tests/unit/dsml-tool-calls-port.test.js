import { describe, expect, it } from "vitest";
import { createDsmlStreamState, MAX_DSML_FRAME, parseDsmlToolCalls } from "../../open-sse/utils/dsmlToolCalls.js";

const frame = '<|DSML|invoke name="run"><|DSML|parameter name="command" string="true">ls</|DSML|parameter><|DSML|parameter name="count" string="false">2</|DSML|parameter></|DSML|invoke>';

describe("DeepSeek DSML parsing", () => {
  it("extracts typed arguments and preserves surrounding prose", () => {
    const result = parseDsmlToolCalls(`before ${frame} after`);
    expect(result.content).toBe("before  after");
    expect(result.toolCalls).toEqual([{ name: "run", arguments: { command: "ls", count: 2 } }]);
  });
  it("handles every possible split, including a wrapped frame", () => {
    const wrapped = `<｜｜DSML｜｜calls>${frame}</｜｜DSML｜｜calls>`;
    for (let i = 0; i <= wrapped.length; i++) {
      const stream = createDsmlStreamState();
      const results = [stream.push(wrapped.slice(0, i)), stream.push(wrapped.slice(i)), stream.flush()];
      expect(results.flatMap((r) => r.toolCalls)).toHaveLength(1);
      expect(results.map((r) => r.text).join("")).toBe("");
    }
  });
  it("supports loose closing tags and prose containing less-than signs", () => {
    const loose = frame.replaceAll('</|DSML|', '<|DSML|');
    const result = parseDsmlToolCalls(`1 < 2 ${loose}`);
    expect(result.content).toBe('1 < 2 ');
    expect(result.toolCalls).toHaveLength(1);
  });
  it("leaves malformed and incomplete frames untouched", () => {
    for (const value of [frame.slice(0, -3), frame.replace('>2</', '>bad</'), '<|DSML|calls>oops</|DSML|calls>']) {
      expect(parseDsmlToolCalls(value)).toEqual({ content: value, toolCalls: [] });
    }
  });
  it("fails open at the frame size limit", () => {
    const text = '<|DSML|invoke name="x">' + 'x'.repeat(MAX_DSML_FRAME);
    const stream = createDsmlStreamState();
    expect(stream.push(text).text).toBe(text);
    expect(stream.push(frame)).toEqual({ text: frame, toolCalls: [] });
  });
});
