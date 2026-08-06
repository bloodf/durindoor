import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { formatSSE } from "../../open-sse/utils/streamHelpers.js";

describe("SSE null flush frames", () => {
  it("emits nothing for same- and cross-format null flushes", () => {
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, null, {})).toEqual([]);
    expect(translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, null, {})).toEqual([]);
    expect(formatSSE(null, FORMATS.OPENAI)).toBe("");
  });
});
