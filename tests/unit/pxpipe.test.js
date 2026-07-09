import { describe, expect, it, vi } from "vitest";
import { compressWithPxpipe, formatPxpipeLog } from "../../open-sse/rtk/pxpipe.js";

const bigText = "x".repeat(30000);
const claudeBody = () => ({
  model: "claude-fable-5",
  max_tokens: 100,
  messages: [{ role: "user", content: bigText }],
});

// A transform double mimicking pxpipe-proxy/transform's contract.
const appliedTransform = (outBody) => async () => ({
  applied: true,
  reason: "applied",
  body: new TextEncoder().encode(JSON.stringify(outBody)),
  info: { compressedChars: 25000, imageCount: 2, imageBytes: 5000, imagePixels: 1500000 },
  cache: { ownsCacheControl: true, markerCount: 1 },
});

describe("compressWithPxpipe gates", () => {
  it("skips when disabled", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: false });
    expect(body).toBeNull();
    expect(summary.reason).toBe("disabled");
  });

  it("skips when transform is unavailable (not installed)", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: true, format: "claude", transform: null });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_installed");
  });

  it("skips unsupported OpenAI formats that are not Blackbox Fable aliases", async () => {
    const transform = vi.fn();
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "openai", model: "gpt-4o", transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("unsupported_format");
    expect(transform).not.toHaveBeenCalled();
  });

  it("reaches transform for OpenAI-format Blackbox Anthropic Fable aliases", async () => {
    // Blackbox ships Fable as an OpenAI-format upstream id. The transform still
    // speaks Anthropic Messages, so compressWithPxpipe must normalize before call.
    const openaiBody = {
      model: "blackboxai/anthropic/claude-fable-5",
      max_tokens: 100,
      messages: [{ role: "user", content: bigText }],
    };
    const compressed = {
      model: "blackboxai/anthropic/claude-fable-5",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
      }],
    };
    const transform = vi.fn(async ({ body }) => {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      // Transform contract is Anthropic Messages (content blocks, not OpenAI strings).
      expect(Array.isArray(parsed.messages?.[0]?.content)).toBe(true);
      expect(parsed.messages[0].content[0]).toMatchObject({ type: "text" });
      expect(parsed.model).toBe("blackboxai/anthropic/claude-fable-5");
      return {
        applied: true,
        reason: "applied",
        body: new TextEncoder().encode(JSON.stringify(compressed)),
        info: { compressedChars: 25000, imageCount: 1, imageBytes: 100, imagePixels: 75000 },
        cache: { ownsCacheControl: false, markerCount: 0 },
      };
    });

    const { body, summary } = await compressWithPxpipe(openaiBody, {
      enabled: true,
      format: "openai",
      model: "blackboxai/anthropic/claude-fable-5",
      minChars: 1000,
      transform,
    });

    expect(transform).toHaveBeenCalledTimes(1);
    expect(summary.applied).toBe(true);
    // Round-trip back to OpenAI shape for the Blackbox OpenAI transport.
    expect(body.model).toBe("blackboxai/anthropic/claude-fable-5");
    expect(body.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image_url" }),
      ])
    );
  });

  it("fails open when OpenAI→Claude preparation throws", async () => {
    // Defensive malformed OpenAI boundary: openaiToClaudeRequest derefs
    // part.image_url.url without a guard. Preparation must remain inside the fail-open
    // boundary, returning the escaped TypeError without changing the request.
    const openaiBody = {
      model: "blackboxai/anthropic/claude-fable-5",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: bigText },
          { type: "image_url", image_url: {} },
        ],
      }],
    };
    const original = structuredClone(openaiBody);
    const transform = vi.fn(async () => {
      throw new Error("transform must not run when preparation fails");
    });

    const res = await compressWithPxpipe(openaiBody, {
      enabled: true,
      format: "openai",
      model: "blackboxai/anthropic/claude-fable-5",
      minChars: 1,
      transform,
    });

    expect(res.body).toBeNull();
    expect(res.summary.reason).toBe("transform_error");
    expect(res.summary.detail).toMatch(/Cannot read properties of undefined.*startsWith/);
    expect(transform).not.toHaveBeenCalled();
    expect(openaiBody).toEqual(original);
  });

  it("bypasses small prompts below minChars", async () => {
    const transform = vi.fn();
    const small = { model: "claude-fable-5", messages: [{ role: "user", content: "hi" }] };
    const { body, summary } = await compressWithPxpipe(small, { enabled: true, format: "claude", minChars: 25000, transform });
    expect(body).toBeNull();
    expect(summary.reason).toBe("below_threshold");
    expect(transform).not.toHaveBeenCalled();
  });

  it("applies the transform and reports savings", async () => {
    const compressed = { model: "claude-fable-5", messages: [{ role: "user", content: "imaged" }] };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform: appliedTransform(compressed),
    });
    expect(body).toEqual(compressed);
    expect(summary.applied).toBe(true);
    expect(summary.imageCount).toBe(2);
    expect(summary.tokensBeforeEst).toBeGreaterThan(summary.tokensAfterEst);
    expect(summary.savedPct).toBeGreaterThan(0);
    expect(formatPxpipeLog(summary)).toContain("2 image(s)");
  });

  it("passes through when the transform declines (not_profitable)", async () => {
    const transform = async () => ({ applied: false, reason: "not_profitable", body: new Uint8Array(), info: {} });
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_profitable");
  });

  it("fails open when the transform throws", async () => {
    const transform = async () => { throw new Error("boom"); };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("transform_error");
    expect(summary.detail).toBe("boom");
  });

  it("fails open on timeout", async () => {
    const transform = () => new Promise(() => {}); // never resolves
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, timeoutMs: 50, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("timeout");
  });

  it("does not log skipped requests as savings", () => {
    expect(formatPxpipeLog({ applied: false, reason: "below_threshold" })).toBeNull();
    expect(formatPxpipeLog(null)).toBeNull();
  });
});
