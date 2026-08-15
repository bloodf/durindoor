import { describe, expect, it } from "vitest";
import { estimateCompressionTokens } from "../../open-sse/services/compression/stats.js";

describe("estimateCompressionTokens", () => {
  it("preserves short normal text and non-base64 URLs", () => {
    const text = "Read https://example.test/image.png before replying.";
    expect(estimateCompressionTokens(text)).toBe(Math.ceil(text.length / 4));

    const url = "data:image/png,not-base64";
    expect(estimateCompressionTokens(url)).toBe(Math.ceil(url.length / 4));
  });

  it("strips base64 image data URI payloads before estimating (within scan window)", () => {
    const payload = "aGVsbG8=".repeat(100);
    const withImage = `before data:image/png;base64,${payload} after`;
    expect(estimateCompressionTokens(withImage)).toBe(Math.ceil("before  after".length / 4));
  });

  it("keeps controls and non-image base64 data URIs", () => {
    const controls = "\u0000\n\t";
    expect(estimateCompressionTokens(controls)).toBe(Math.ceil(controls.length / 4));

    const audio = "data:audio/mpeg;base64,QUJD";
    expect(estimateCompressionTokens(audio)).toBe(Math.ceil(audio.length / 4));
  });

  it("preserves a malformed/truncated image data URI unchanged", () => {
    const truncated = "before data:image/png;base64, after";
    expect(estimateCompressionTokens(truncated)).toBe(Math.ceil(truncated.length / 4));

    const noPayload = "data:image/png;base64,";
    expect(estimateCompressionTokens(noPayload)).toBe(Math.ceil(noPayload.length / 4));
  });

  function buildUriText(totalLen) {
    const prefix = "before ";
    const uriPrefix = "data:image/png;base64,";
    const suffix = " after";
    const payloadLen = totalLen - prefix.length - uriPrefix.length - suffix.length;
    return `${prefix}${uriPrefix}${"A".repeat(payloadLen)}${suffix}`;
  }

  it("scans and strips at exactly the 50k-char cap boundary", () => {
    const text = buildUriText(50_000);
    expect(text.length).toBe(50_000);
    expect(estimateCompressionTokens(text)).toBe(Math.ceil("before  after".length / 4));
  });

  it("skips scanning one char past the cap: raw length/4 fallback, base64 counted as text (documented tradeoff)", () => {
    const text = buildUriText(50_001);
    expect(text.length).toBe(50_001);
    expect(estimateCompressionTokens(text)).toBe(Math.ceil(50_001 / 4));
  });

  it("never scans past the 50k cap for hostile huge base64 payloads (bounded CPU, not O(n))", () => {
    const original = String.prototype.charCodeAt;
    let calls = 0;
    String.prototype.charCodeAt = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    try {
      const oneMb = `data:image/png;base64,${"A".repeat(1_000_000)}`;
      estimateCompressionTokens(oneMb);
      expect(calls).toBe(0);

      calls = 0;
      const hundredMb = `data:image/png;base64,${"A".repeat(100_000_000)}`;
      estimateCompressionTokens(hundredMb);
      expect(calls).toBe(0);
    } finally {
      String.prototype.charCodeAt = original;
    }
  });

  it("bounds scan iterations to the input size for text at/under the cap", () => {
    const original = String.prototype.charCodeAt;
    let calls = 0;
    String.prototype.charCodeAt = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    try {
      const atCap = buildUriText(50_000);
      estimateCompressionTokens(atCap);
      expect(calls).toBeLessThanOrEqual(50_000);
    } finally {
      String.prototype.charCodeAt = original;
    }
  });
});

