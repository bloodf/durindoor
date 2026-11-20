// Upstream 9router #5640: real upstream usage must replace an estimate, not
// max-merge with it.
//
// utils/stream.js injects estimateUsage() into the finish chunk when the
// provider sends no usage there, then merges the later real usage with
// mergeUsage() (field-wise Math.max). The persisted prompt_tokens therefore
// became max(estimate, real) — inflated whenever the estimate (JSON length / 4
// plus the fixed buffer) exceeded reality.
//
// DurinDoor note: an estimate stays marked `estimated` once it is set (a real
// value never downgrades an estimate to authoritative), and a provider that
// meters in credits only (Kiro) reports no token counts at all — there the
// estimate still supplies them.
import { describe, it, expect, vi } from "vitest";
import { mergeUsage } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function feed(sseText, transform) {
  const input = new Blob([sseText]).stream();
  return drain(input.pipeThrough(transform));
}

const oa = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chatChunk = (delta, finish = null) => ({
  id: "chatcmpl-abcdef123456",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-x",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const body = { model: "gpt-x", messages: [{ role: "user", content: "hi" }] };

describe("mergeUsage — estimate vs real", () => {
  it("a real report replaces an estimate instead of max-merging", () => {
    const estimate = { prompt_tokens: 2016, completion_tokens: 2, total_tokens: 2018, estimated: true };
    const real = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    const merged = mergeUsage(estimate, real);
    // The real counts replace the estimate — never max(estimate, real).
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.completion_tokens).toBe(50);
    expect(merged.total_tokens).toBe(150);
    // The estimation marker is sticky here: once estimated, stays estimated.
    expect(merged.estimated).toBe(true);
  });

  it("an estimate never overwrites real usage", () => {
    const real = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    const estimate = { prompt_tokens: 2016, completion_tokens: 2, total_tokens: 2018, estimated: true };
    expect(mergeUsage(real, estimate)).toEqual(real);
  });

  it("still max-merges partial REAL reports (Anthropic split usage)", () => {
    const start = { prompt_tokens: 100, completion_tokens: 0, cache_read_input_tokens: 30 };
    const delta = { prompt_tokens: 0, completion_tokens: 50 };
    expect(mergeUsage(start, delta)).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 30,
    });
  });

  it("keeps the estimate's counts when the real report has none (Kiro credits)", () => {
    const credits = { kiro_credits: 0.0123, kiro_credit_unit: "credit" };
    const estimate = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49, estimated: true };
    const merged = mergeUsage(credits, estimate);
    expect(merged.kiro_credits).toBe(0.0123);
    expect(merged.kiro_credit_unit).toBe("credit");
    expect(merged.prompt_tokens).toBe(42);
    expect(merged.estimated).toBe(true);

    const reversed = mergeUsage(estimate, credits);
    expect(reversed.kiro_credits).toBe(0.0123);
    expect(reversed.prompt_tokens).toBe(42);
    expect(reversed.estimated).toBe(true);
  });
});

describe("passthrough stream — finish_reason before the usage trailer", () => {
  it("persists the real usage, not max(estimate, real)", async () => {
    let persisted = null;
    const upstream =
      oa(chatChunk({ role: "assistant", content: "Hello there" })) +
      oa(chatChunk({}, "stop")) +
      oa({ id: "chatcmpl-abcdef123456", choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) +
      "data: [DONE]\n\n";

    const out = await feed(
      upstream,
      createPassthroughStreamWithLogger("openai", null, null, "gpt-x", "c1", body, (_content, usage) => { persisted = usage; })
    );

    expect(out).toContain('"prompt_tokens":100');
    expect(persisted).toMatchObject({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });

  it("persists the estimated counts when the provider reports credits only", async () => {
    let persisted = null;
    const upstream =
      oa(chatChunk({ role: "assistant", content: "Hello there" })) +
      oa(chatChunk({}, "stop")) +
      oa({ id: "chatcmpl-abcdef123456", choices: [], usage: { kiro_credits: 0.0123, kiro_credit_unit: "credit" } }) +
      "data: [DONE]\n\n";

    await feed(
      upstream,
      createPassthroughStreamWithLogger("kiro", null, null, "gpt-x", "c1", body, (_content, usage) => { persisted = usage; })
    );

    expect(persisted).toMatchObject({ kiro_credits: 0.0123, kiro_credit_unit: "credit" });
    expect(persisted.prompt_tokens).toBeGreaterThan(0);
    expect(persisted.estimated).toBe(true);
  });
});
