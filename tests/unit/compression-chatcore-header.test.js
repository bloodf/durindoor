// F-1b chatCore wiring integration: handleChatCore must call runCompressionSeam
// when compression is enabled, capture its headerValue onto the FINAL response
// (the one chatCore's terminal handler builds), and must NOT call the seam or
// emit the header when disabled. The seam itself is mocked — its real behavior
// is covered by compression-chatcore-f1b.test.js; here we prove the wiring.
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
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

describe("handleChatCore compression header wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  it("enabled + seam reports header -> streaming final response carries X-DurinDoor-Compression", async () => {
    runCompressionSeam.mockImplementation(async (body) => ({
      body: {
        ...body,
        messages: [{ role: "user", content: "COMPRESSED-BY-SEAM" }],
      },
      headerValue: "caveman|12.5%",
    }));

    const result = await handleChatCore(
      baseArgs({ compressionEnabled: true, compressionEngines: { caveman: { enabled: true } } })
    );

    expect(runCompressionSeam).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body.messages[0].content).toBe("COMPRESSED-BY-SEAM");
    expect(result.response).toBeInstanceOf(Response);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(result.response.headers.get(HEADER)).toBe("caveman|12.5%");
  });

  it("enabled + seam reports header -> non-streaming (JSON) final response carries X-DurinDoor-Compression", async () => {
    runCompressionSeam.mockImplementation(async (body) => ({
      body: {
        ...body,
        messages: [{ role: "user", content: "COMPRESSED-BY-SEAM" }],
      },
      headerValue: "caveman|12.5%",
    }));
    executeMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({
        model: "llama3",
        created_at: "2026-07-10T12:00:00.000Z",
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 2,
        eval_count: 1,
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "http://localhost:11434/api/chat",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });

    // ollama-local has no forceStream/forceNonStreaming, body.stream=false,
    // so chatCore naturally routes through handleNonStreamingResponse (JSON).
    const result = await handleChatCore(
      baseArgs({
        compressionEnabled: true,
        compressionEngines: { caveman: { enabled: true } },
        modelInfo: { provider: "ollama-local", model: "llama3" },
        credentials: { apiKey: "", providerSpecificData: { baseUrl: "http://localhost:11434" } },
      })
    );

    expect(runCompressionSeam).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].body.messages[0].content).toBe("COMPRESSED-BY-SEAM");
    expect(result.response).toBeInstanceOf(Response);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toMatch(/application\/json/);
    expect(result.response.headers.get(HEADER)).toBe("caveman|12.5%");
  });

  it("enabled but seam returns null header -> no header on response", async () => {
    runCompressionSeam.mockImplementation(async (body) => ({ body, headerValue: null }));

    const result = await handleChatCore(
      baseArgs({ compressionEnabled: true, compressionEngines: { caveman: { enabled: true } } })
    );

    expect(runCompressionSeam).toHaveBeenCalledTimes(1);
    expect(result.response.headers.get(HEADER)).toBeNull();
  });

  it("disabled -> seam not called and header absent", async () => {
    const result = await handleChatCore(baseArgs({ compressionEnabled: false }));

    expect(runCompressionSeam).not.toHaveBeenCalled();
    expect(result.response.headers.get(HEADER)).toBeNull();
  });

  it("seam throws -> fail-open: response still returned, no header", async () => {
    runCompressionSeam.mockRejectedValue(new Error("planner exploded"));

    const result = await handleChatCore(
      baseArgs({ compressionEnabled: true, compressionEngines: { caveman: { enabled: true } } })
    );

    expect(result.response).toBeInstanceOf(Response);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get(HEADER)).toBeNull();
  });
});
