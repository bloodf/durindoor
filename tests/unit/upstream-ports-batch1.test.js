import { describe, it, expect } from "vitest";
import { fixToolUseOrdering } from "../../open-sse/translator/formats/claude.js";
import { claudeUsageToOpenAI } from "../../open-sse/utils/usageTracking.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("#2663 — claude tool_result reconciliation", () => {
  it("demotes an unpaired tool_result to user text and keeps a paired one", () => {
    const out = fixToolUseOrdering([
      { role: "user", content: [{ type: "text", text: "q" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "read", input: {} }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu1", content: "ok" },
          { type: "tool_result", tool_use_id: "orphan", content: "stale" },
        ],
      },
    ]);
    const last = out[out.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text");
    // The paired tu1 survives as a tool_result; the orphan becomes user text.
    expect(results.map((r) => r.tool_use_id)).toEqual(["tu1"]);
    expect(texts.some((t) => t.text.includes("Unpaired tool result orphan"))).toBe(true);
  });

  it("leaves an ordinary user message (no tool_result) untouched", () => {
    const msgs = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
      { role: "user", content: [{ type: "text", text: "c" }] },
    ];
    const out = fixToolUseOrdering(msgs);
    expect(out[2].content).toEqual([{ type: "text", text: "c" }]);
  });
});

describe("#2658 — Claude usage folds cache tokens into prompt_tokens", () => {
  it("includes cache read + creation in prompt_tokens", () => {
    const u = claudeUsageToOpenAI({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    });
    // Claude reports input_tokens EXCLUSIVE of cache; OpenAI prompt_tokens is inclusive.
    expect(u.prompt_tokens).toBe(150);
    expect(u.completion_tokens).toBe(20);
    expect(u.prompt_tokens_details.cached_tokens).toBe(40);
    expect(u.prompt_tokens_details.cache_creation_tokens).toBe(10);
  });

  it("yields zeroed usage for empty input", () => {
    const u = claudeUsageToOpenAI(null);
    expect(u.prompt_tokens).toBe(0);
    expect(u.completion_tokens).toBe(0);
  });
});

describe("#2697 — bare k3 upstream id resolves to the K3 window", () => {
  it("resolves bare k3 to 1M context (not the 200K default)", () => {
    const caps = getCapabilitiesForModel("moonshot", "k3");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.reasoning).toBe(true);
  });
});
