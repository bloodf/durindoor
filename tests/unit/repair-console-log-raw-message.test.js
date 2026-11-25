// @vitest-environment happy-dom
import { fireEvent, within } from "@testing-library/dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ConsoleLogClient from "@/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js";
import { startConsoleLogTransport } from "@/app/(dashboard)/dashboard/console-log/transport.js";
import { describe, expect, it, vi } from "vitest";
import { parseConsoleLine } from "@/app/(dashboard)/dashboard/console-log/parseConsoleLine.js";
import { fmtThink, formatRequestLine, line } from "@/sse/utils/logger.js";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

vi.mock("@/app/(dashboard)/dashboard/console-log/transport.js", () => ({
  startConsoleLogTransport: vi.fn(),
}));

function captureLine(symbol, message) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    line("🟢", symbol, message);
    return log.mock.calls[0][0];
  } finally {
    log.mockRestore();
  }
}

describe("structured console rows from the gateway formatters", () => {
  it("retains the routed model, credits, and session suffix on DONE", () => {
    const raw = captureLine("📊", formatDoneLine({
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 100,
        kiro_credits: 0.12345,
      },
      latency: { total: 1523, ttft: 410 },
      provider: "kiro",
      model: "claude-sonnet-4-5",
      sessionId: "claude:abcd1234-extra",
    }));
    const entry = parseConsoleLine(raw);

    expect(entry.completion).toEqual({
      totalMs: 1523,
      ttftMs: 410,
      inputTokens: 1200,
      outputTokens: 340,
      cacheRead: 800,
      cacheCreate: 100,
      cacheReusedPercent: 38.1,
      routedModel: "kiro/claude-sonnet-4-5",
      credits: 0.1235,
      sessionId: "abcd1234",
    });
    expect(entry.raw).toBe(raw);
  });

  it("keeps THINK with the POST format, counts, and account", () => {
    const raw = captureLine("▶", formatRequestLine({
      clientModel: "my-model",
      routedModel: "openai/my-model",
      format: "openai (passthrough)",
      stream: false,
      messages: 2,
      tools: 1,
      thinking: fmtThink({ mode: "level", level: "high" }),
      account: "Team · JSON proxy",
    }));
    const entry = parseConsoleLine(raw);

    expect(entry.request).toEqual({
      model: "my-model",
      routedModel: "openai/my-model",
      format: "openai (passthrough)",
      mode: "JSON",
      messages: 2,
      tools: 1,
      thinking: "high",
      account: "Team · JSON proxy",
    });
    expect(entry.raw).toBe(raw);
  });

  it("distinguishes cache creation from reads and accepts zero credits without a provider prefix", () => {
    const raw = captureLine("📊", formatDoneLine({
      usage: { cache_creation_input_tokens: 100, kiro_credits: 0 },
      model: "local-model",
    }));
    expect(parseConsoleLine(raw).completion).toMatchObject({
      cacheRead: 0,
      cacheCreate: 100,
      credits: 0,
      routedModel: "local-model",
    });
  });

  it("shows the original message when wrapped and falls back to it for partial rows", () => {
    const raw = captureLine("📊", formatDoneLine({
      usage: { kiro_credits: 0 },
      provider: "kiro",
      model: "test-model",
      sessionId: "abcd1234-extra",
    }));
    const partial = raw + " · unexpected field";
    startConsoleLogTransport.mockImplementation(({ onSnapshot }) => {
      onSnapshot([raw, partial]);
      return { stop: vi.fn() };
    });

    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(ConsoleLogClient)));
      const [structuredRow, partialRow] = container.querySelectorAll("[data-console-row]");
      expect(structuredRow.textContent).toContain("DONE 0ms · IN 0 · OUT 0 · kiro/test-model · 0cr · sid:abcd1234");
      expect(structuredRow.title).toBe(raw);
      expect(partialRow.textContent).toContain(parseConsoleLine(partial).message);

      act(() => fireEvent.click(within(container).getByRole("button", { name: "Wrap lines" })));
      expect(structuredRow.textContent).toContain(parseConsoleLine(raw).message);
      expect(partialRow.textContent).toContain(parseConsoleLine(partial).message);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
