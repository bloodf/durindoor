import { describe, expect, it } from "vitest";
import { parseConsoleLine } from "@/app/(dashboard)/dashboard/console-log/parseConsoleLine.js";

describe("#5798 structured console rows", () => {
  it("extracts request fields from the existing log text without changing its raw form", () => {
    const raw = "[10:22:31] 🟢 → POST claude-sonnet-4-5 → anthropic/claude-sonnet-4-5 · FMT: openai→claude · STREAM · 12 MSG · 3 TOOL · ACC:acct-1";
    const entry = parseConsoleLine(raw);

    expect(entry.request).toEqual({
      model: "claude-sonnet-4-5",
      routedModel: "anthropic/claude-sonnet-4-5",
      format: "openai→claude",
      mode: "STREAM",
      messages: 12,
      tools: 3,
      account: "acct-1",
    });
    expect(entry.raw).toBe(raw);
  });

  it("extracts completion latency, token counts, cache counts, and routed model", () => {
    const entry = parseConsoleLine("[10:22:33] 🟢 📊 DONE 1523ms · TTFT 410ms · IN 1200 (CACHE ↻800 +100) · OUT 340 · anthropic/claude-sonnet-4-5");

    expect(entry.completion).toEqual({
      totalMs: 1523,
      ttftMs: 410,
      inputTokens: 1200,
      outputTokens: 340,
      cacheRead: 800,
      cacheCreate: 100,
      routedModel: "anthropic/claude-sonnet-4-5",
    });
  });

  it("leaves unrelated log lines without structured request or completion data", () => {
    expect(parseConsoleLine("[10:22:33] ℹ️ [TOKEN_REFRESH] credentials updated"))
      .not.toHaveProperty("request");
    expect(parseConsoleLine("[10:22:33] ℹ️ [TOKEN_REFRESH] credentials updated"))
      .not.toHaveProperty("completion");
  });
});
