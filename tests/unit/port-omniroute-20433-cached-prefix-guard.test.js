import { describe, expect, it } from "vitest";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";
import { shouldProtectCachedPrefix } from "../../open-sse/config/promptCacheProviders.js";
import { applyLiteCompression } from "../../open-sse/services/compression/engines/lite.js";

const LONG = "word ".repeat(200);
const ENGINES = { lite: { enabled: true, truncateToolResults: true, maxToolLength: 256 } };

const turn = (id) => [
  { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }] },
  { role: "tool", tool_call_id: id, content: LONG },
];
const body = () => ({ model: "m", messages: [{ role: "user", content: "go" }, ...turn("a"), ...turn("b"), ...turn("c")] });
const toolContents = (result) => result.messages.filter((m) => m.role === "tool").map((m) => m.content);

const run = (input, cachedPrefix) =>
  runCompressionSeam(input, undefined, { enabled: true, engines: ENGINES, applyOpts: { format: "openai", cachedPrefix } });

describe("OmniRoute #20433 - compression leaves the provider-cached prefix alone", () => {
  it("truncates earlier turns when the target keeps no prompt cache", async () => {
    const [first, second, current] = toolContents((await run(body(), false)).body);
    expect(first).toMatch(/\.\.\.\[truncated\]$/);
    expect(second).toMatch(/\.\.\.\[truncated\]$/);
    expect(current).toBe(LONG);
  });

  it("sends every earlier turn byte-identical to a caching target", async () => {
    const input = body();
    const result = await run(input, true);
    expect(result.body.messages).toEqual(input.messages);
    expect(result.headerValue).toBeNull();
  });

  it("protects only through the last cache_control marker", async () => {
    const input = body();
    input.messages[2] = { ...input.messages[2], cache_control: { type: "ephemeral" } };
    const [first, second, current] = toolContents((await run(input, true)).body);
    expect(first).toBe(LONG);
    expect(second).toMatch(/\.\.\.\[truncated\]$/);
    expect(current).toBe(LONG);
  });

  it("protects everything under a top-level cache_control", () => {
    const input = { ...body(), cache_control: { type: "ephemeral" } };
    expect(applyLiteCompression(input, { truncateToolResults: true, maxToolLength: 256, cachedPrefix: true }).compressed).toBe(false);
  });

  it("keeps a Responses history stable for a caching target", async () => {
    const input = {
      model: "m",
      input: [
        { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
        { type: "function_call_output", call_id: "a", output: LONG },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
      ],
    };
    expect((await run(input, true)).body.input).toEqual(input.input);
    expect((await run(input, false)).body.input[1].output).toMatch(/\.\.\.\[truncated\]$/);
  });

  it("classifies caching targets and lifts protection above the context window", () => {
    expect(shouldProtectCachedPrefix({ provider: "codex", format: "openai-responses" })).toBe(true);
    expect(shouldProtectCachedPrefix({ provider: "anthropic-compatible-x", format: "claude" })).toBe(true);
    expect(shouldProtectCachedPrefix({ provider: "groq", format: "openai" })).toBe(false);
    expect(shouldProtectCachedPrefix({ provider: "openai", format: "openai", estimatedTokens: 5000, contextWindow: 4000 })).toBe(false);
    expect(shouldProtectCachedPrefix({ provider: "openai", format: "openai", estimatedTokens: 3000, contextWindow: 4000 })).toBe(true);
  });

  it.each([
    ["reserve-output", { outputReserve: 2000, safetyMargin: 1000 }, 7000],
    ["percentage", { pct: 0.7 }, 7000],
    ["absolute", { absoluteBudget: 7000 }, 7000],
  ])("uses the %s adaptive target for a caching provider", async (policy, settings, target) => {
    const input = body();
    const runAt = (estimatedTokens, overrides = {}) => runCompressionSeam(input, undefined, {
      enabled: true, engines: ENGINES,
      applyOpts: { format: "openai", cachedPrefix: shouldProtectCachedPrefix({ provider: "openai", format: "openai", estimatedTokens, contextWindow: 10000 }) },
      adaptive: { mode: "replace-autotrigger", policy, modelContextLimit: 10000, estimatedTokens, ...settings, ...overrides },
    });
    const above = await runAt(target + 1);
    expect(toolContents(above.body)[0]).toMatch(/\.\.\.\[truncated\]$/);
    expect(above.headerValue).toMatch(/^lite\|/);
    expect(toolContents((await runAt(target)).body)[0]).toBe(LONG);
    expect(toolContents((await runAt(target + 1, { mode: "off" })).body)[0]).toBe(LONG);
    expect(toolContents((await runAt(target + 1, { modelContextLimit: null })).body)[0]).toBe(LONG);
    expect(toolContents((await runAt(target + 1)).body)[2]).toBe(LONG);
  });
});
