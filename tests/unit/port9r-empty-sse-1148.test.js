import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { formatSSE } from "../../open-sse/utils/streamHelpers.js";

describe("empty SSE events", () => {
  it("omits null flushes for matching formats", () => {
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, null, {})).toEqual([]);
    expect(translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, null, {})).toEqual([]);
  });

  it("does not serialize absent events", () => {
    expect(formatSSE(null, FORMATS.OPENAI)).toBe("");
    expect(formatSSE(undefined, FORMATS.OPENAI)).toBe("");
    expect(formatSSE({ done: true }, FORMATS.OPENAI)).toBe("data: [DONE]\n\n");
  });
});
