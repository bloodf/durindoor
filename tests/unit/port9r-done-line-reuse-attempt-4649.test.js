import { describe, expect, it, vi } from "vitest";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { parseConsoleLine } from "../../src/app/(dashboard)/dashboard/console-log/parseConsoleLine.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

describe("decolua/9router#4649 cache reuse and combo attempt depth in logs", () => {
  it.each([
    ["cache-inclusive OpenAI usage", { prompt_tokens: 1000, completion_tokens: 5, cached_tokens: 900 }, "IN 1000 (CACHE ↻900) 90.0% reused"],
    ["cache-exclusive Claude usage", { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 }, "IN 100 (CACHE ↻800 +100) 80.0% reused"],
    ["Responses detail counts", { input_tokens: 400, output_tokens: 5, prompt_tokens_details: { cached_tokens: 100 } }, "IN 400 (CACHE ↻100) 25.0% reused"],
  ])("reports the reused share for %s", (_label, usage, expected) => {
    expect(formatDoneLine({ usage, latency: { total: 1 } })).toBe(`DONE 1ms · ${expected} · OUT 5`);
  });

  it("omits the share without cache reads", () => {
    expect(formatDoneLine({ usage: { prompt_tokens: 10, completion_tokens: 5, cache_creation_input_tokens: 4 }, latency: { total: 1 } }))
      .toBe("DONE 1ms · IN 10 (CACHE +4) · OUT 5");
  });

  it("omits an impossible share when the provider reports more cache reads than input", () => {
    expect(formatDoneLine({ usage: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 50 }, latency: { total: 1 } }))
      .toBe("DONE 1ms · IN 10 (CACHE ↻50) · OUT 5");
  });

  it("keeps the console log viewer parsing the line", () => {
    const line = formatDoneLine({ usage: { prompt_tokens: 1000, completion_tokens: 5, cached_tokens: 900 }, latency: { total: 7 }, model: "m" });
    expect(parseConsoleLine(line).completion).toMatchObject({ inputTokens: 1000, cacheRead: 900, cacheReusedPercent: 90, outputTokens: 5, routedModel: "m" });
  });

  it("logs which attempt served a combo request", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const handleSingleModel = vi.fn(async (_body, model) => model === "openai/first"
      ? Response.json({ error: { message: "upstream unavailable" } }, { status: 503 })
      : Response.json({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }));
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      models: ["openai/first", "openai/second"],
      handleSingleModel,
      log,
      comboName: "depth-4649",
      comboStrategy: "fallback",
    });
    expect(response.status).toBe(200);
    expect(log.info).toHaveBeenCalledWith("COMBO", "Model openai/second succeeded · ATTEMPT 2/2");
  });
});
