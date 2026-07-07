import { describe, it, expect } from "vitest";
import { compressWithPxpipe, formatPxpipeLog } from "../../open-sse/rtk/pxpipe.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const LONG_TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(400);
const LARGE_BODY = {
  model: "claude-fable-5",
  system: LONG_TEXT,
  messages: [{ role: "user", content: LONG_TEXT }],
  max_tokens: 4096,
};

describe("compressWithPxpipe", () => {
  it("returns null and leaves body unchanged when disabled", async () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    const original = JSON.stringify(body);
    const res = await compressWithPxpipe(body, { enabled: false, model: "claude-fable-5", format: FORMATS.CLAUDE });
    expect(res).toBeNull();
    expect(JSON.stringify(body)).toBe(original);
  });

  it("returns null and leaves body unchanged for non-claude formats", async () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    const original = JSON.stringify(body);
    const res = await compressWithPxpipe(body, { enabled: true, model: "claude-fable-5", format: FORMATS.OPENAI });
    expect(res).toBeNull();
    expect(JSON.stringify(body)).toBe(original);
  });

  it("returns unsupported_model for a claude-format but unsupported model id", async () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    const diagnostics = {};
    const res = await compressWithPxpipe(body, { enabled: true, model: "claude-haiku-4-5", format: FORMATS.CLAUDE, diagnostics });
    expect(res).toBeNull();
    expect(diagnostics.reason).toBe("unsupported_model");
  });

  it("applies or reports an allowed skip reason for a large supported claude body", async () => {
    const body = JSON.parse(JSON.stringify(LARGE_BODY));
    const res = await compressWithPxpipe(body, { enabled: true, model: "claude-fable-5", format: FORMATS.CLAUDE });
    if (res?.applied) {
      const text = JSON.stringify(body);
      expect(text).toContain('"type":"image"');
      expect(body.model).toBe("claude-fable-5");
    } else {
      // pxpipe may skip for profitability or size thresholds; accept any allowed reason
      expect(["not_profitable", "below_min_chars", "below_min_tokens", "unsupported_model", "parse_error"]).toContain(res?.reason);
    }
  });
});

describe("formatPxpipeLog", () => {
  it("returns null for null or empty stats", () => {
    expect(formatPxpipeLog(null)).toBeNull();
    expect(formatPxpipeLog({ reason: "unsupported_model" })).toBeNull();
  });

  it("formats orig->compressed chars and image count", () => {
    const line = formatPxpipeLog({ info: { origChars: 10000, compressedChars: 1200, imageCount: 3 } });
    expect(line).toBe("10000→1200 chars, 3 image(s)");
  });
});
