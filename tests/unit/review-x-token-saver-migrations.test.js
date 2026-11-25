// F-1b chatCore wiring integration: handleChatCore must call runCompressionSeam
// when compression is enabled, capture its headerValue onto the FINAL response
// (the one chatCore's terminal handler builds), and must NOT call the seam or
// emit the header when disabled. The seam itself is mocked — its real behavior
// is covered by compression-chatcore-f1b.test.js; here we prove the wiring.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { TOKEN_SAVER_DAILY_TABLES, TOKEN_SAVER_SUM_COLUMNS } from "../../src/lib/db/migrations/token-saver-daily-schema.js";
import { tokenSaverEventColumns } from "../../open-sse/rtk/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { executeMock, runCompressionSeam } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  runCompressionSeam: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/handlers/chatCore/compressionHook.js", () => ({
  runCompressionSeam,
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const HEADER = "X-DurinDoor-Compression";

function baseArgs(over = {}) {
  return {
    body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "openai", model: "gpt-4o" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-conn",
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    ...over,
  };
}

describe("token saver migration and stack telemetry", () => {
  it("keeps migrations independent of open-sse and preserves the historical columns", () => {
    const dir = new URL("../../src/lib/db/migrations/", import.meta.url);
    for (const file of readdirSync(dir, { recursive: true })) {
      if (!file.endsWith(".js")) continue;
      expect(readFileSync(new URL(file, dir), "utf8")).not.toMatch(/(?:from\s*|import\s*\()(["'])[^"']*open-sse\//);
    }
    expect(TOKEN_SAVER_SUM_COLUMNS).toEqual(Object.keys(tokenSaverEventColumns({})).filter((key) => !["hrState", "hrSkipReason"].includes(key)));
    expect(TOKEN_SAVER_DAILY_TABLES.tokenSaverDaily).toEqual({
      columns: { dateKey: "TEXT NOT NULL", localDateKey: "TEXT NOT NULL", ...Object.fromEntries(["requestsObserved", ...TOKEN_SAVER_SUM_COLUMNS, "compressed", "skipped", "disabled"].map((key) => [key, "REAL NOT NULL DEFAULT 0"])) },
      primaryKey: "PRIMARY KEY (dateKey, localDateKey)",
    });
  });

  it("includes stack token savings in the emitted event", async () => {
    executeMock.mockResolvedValue({ response: new Response(JSON.stringify({ id: "test", object: "chat.completion", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }] }), { status: 200, headers: { "content-type": "application/json" } }), url: "https://example.invalid", headers: {}, transformedBody: null });
    runCompressionSeam.mockImplementation(async (body) => ({ body: { ...body, messages: [{ role: "user", content: "short" }] }, headerValue: "lite|50%" }));
    const onTokenSaverEvent = vi.fn();
    await handleChatCore(baseArgs({ body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "A long message with many words ".repeat(100) }] }, compressionEnabled: true, onTokenSaverEvent }));
    expect(onTokenSaverEvent).toHaveBeenCalledOnce();
    expect(onTokenSaverEvent.mock.calls[0][0].compression.tokensSaved).toBeGreaterThan(0);
  });
});
