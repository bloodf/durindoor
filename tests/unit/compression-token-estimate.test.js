import { describe, expect, it } from "vitest";
import { estimateCompressionTokens } from "../../open-sse/services/compression/stats.js";

describe("estimateCompressionTokens", () => {
  it("preserves short normal text and non-base64 URLs", () => {
    const text = "Read https://example.test/image.png before replying.";
    expect(estimateCompressionTokens(text)).toBe(Math.ceil(text.length / 4));

    const url = "data:image/png,not-base64";
    expect(estimateCompressionTokens(url)).toBe(Math.ceil(url.length / 4));
  });

  it("strips base64 image data URI payloads before estimating", () => {
    const payload = "aGVsbG8=".repeat(100);
    const withImage = `before data:image/png;base64,${payload} after`;
    expect(estimateCompressionTokens(withImage)).toBe(Math.ceil("before  after".length / 4));
  });

  it("scales linearly with text length past 50k chars (no silent cap)", () => {
    const huge = "x".repeat(50_001);
    expect(estimateCompressionTokens(huge)).toBe(Math.ceil(50_001 / 4));
  });

  it("does not count hostile huge base64 image payloads", () => {
    const payload = "A".repeat(1_000_000);
    expect(estimateCompressionTokens(`data:image/png;base64,${payload}`)).toBe(0);
  });

  it("keeps controls and non-image base64 data URIs", () => {
    const controls = "\u0000\n\t";
    expect(estimateCompressionTokens(controls)).toBe(Math.ceil(controls.length / 4));

    const audio = "data:audio/mpeg;base64,QUJD";
    expect(estimateCompressionTokens(audio)).toBe(Math.ceil(audio.length / 4));
  });
});
