import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock, runCompressionSeamMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  runCompressionSeamMock: vi.fn(async (body) => ({ body, headerValue: null })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
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

vi.mock("../../open-sse/handlers/chatCore/compressionHook.js", () => ({
  runCompressionSeam: runCompressionSeamMock,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const {
  resolveTokenSaverEnabled,
  TOKEN_SAVER_PRIMARY_HEADER,
  TOKEN_SAVER_LEGACY_HEADER,
} = await import("../../open-sse/rtk/index.js");

describe("resolveTokenSaverEnabled (#2609)", () => {
  it("exports the wire header names", () => {
    expect(TOKEN_SAVER_PRIMARY_HEADER).toBe("x-durindoor-token-saver");
    expect(TOKEN_SAVER_LEGACY_HEADER).toBe("x-9router-token-saver");
  });

  it("enables savers when no bypass header is present", () => {
    expect(resolveTokenSaverEnabled(undefined)).toBe(true);
    expect(resolveTokenSaverEnabled({})).toBe(true);
    expect(resolveTokenSaverEnabled({ accept: "application/json" })).toBe(true);
  });

  it("bypasses on X-DurinDoor-Token-Saver: off (case-insensitive value and key)", () => {
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": "off" })).toBe(false);
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": "OFF" })).toBe(false);
    expect(resolveTokenSaverEnabled({ "X-DurinDoor-Token-Saver": "Off" })).toBe(false);
  });

  it("bypasses on the legacy X-9Router-Token-Saver: off alias", () => {
    expect(resolveTokenSaverEnabled({ "x-9router-token-saver": "off" })).toBe(false);
    expect(resolveTokenSaverEnabled({ "X-9Router-Token-Saver": "OFF" })).toBe(false);
  });

  it("gives the DurinDoor header precedence over a conflicting legacy header", () => {
    expect(resolveTokenSaverEnabled({
      "x-durindoor-token-saver": "on",
      "x-9router-token-saver": "off",
    })).toBe(true);
    expect(resolveTokenSaverEnabled({
      "x-durindoor-token-saver": "off",
      "x-9router-token-saver": "on",
    })).toBe(false);
    // Empty primary is still present: it must NOT fall through to legacy.
    expect(resolveTokenSaverEnabled({
      "x-durindoor-token-saver": "",
      "x-9router-token-saver": "off",
    })).toBe(true);
  });

  it("only the exact value 'off' bypasses; other values stay enabled", () => {
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": "on" })).toBe(true);
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": "0" })).toBe(true);
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": " off " })).toBe(true);
    expect(resolveTokenSaverEnabled({ "x-durindoor-token-saver": "offx" })).toBe(true);
  });

  it("reads Fetch API Headers instances", () => {
    expect(resolveTokenSaverEnabled(new Headers({ "X-DurinDoor-Token-Saver": "off" }))).toBe(false);
    expect(resolveTokenSaverEnabled(new Headers({ "X-9Router-Token-Saver": "off" }))).toBe(false);
    expect(resolveTokenSaverEnabled(new Headers())).toBe(true);
  });
});

describe("handleChatCore token-saver bypass (#2609)", () => {
  const cavemanMarker = "caveman";
  // Fresh per request: handleChatCore mutates the request body in place.
  const makeMessages = () => [{ role: "user", content: "Write polished prose." }];

  const baseRequest = (headers) => ({
    body: { model: "gpt-4o", stream: false, messages: makeMessages() },
    modelInfo: { provider: "openai", model: "gpt-4o" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-conn",
    headroomEnabled: true,
    headroomUrl: "http://localhost:8787",
    headroomCompressUserMessages: true,
    rtkEnabled: true,
    cavemanEnabled: true,
    cavemanLevel: "full",
    ponytailEnabled: true,
    ponytailLevel: "full",
    pxpipeEnabled: true,
    pxpipeTransform: vi.fn(),
    compressionEnabled: true,
    compressionEngines: {},
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: {},
      headers: { accept: "application/json", ...headers },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    });
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  const dispatchedBody = () => executeMock.mock.calls[0][0].body;

  it("control: runs every saver when no bypass header is sent", async () => {
    const req = baseRequest({});
    // Headroom proxy answers with compressed messages.
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        return new Response(JSON.stringify({
          messages: [{ role: "user", content: "compressed" }],
          tokens_before: 100,
          tokens_after: 10,
          tokens_saved: 90,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handleChatCore(req);

    // Headroom fetch ran and compression seam executed (not bypassed).
    expect(global.fetch).toHaveBeenCalled();
    expect(runCompressionSeamMock).toHaveBeenCalled();
    // Caveman injected a system prompt into the dispatched body.
    const systemMsgs = dispatchedBody().messages.filter(m => m.role === "system" || m.role === "developer");
    expect(systemMsgs.length).toBeGreaterThan(0);
    expect(JSON.stringify(systemMsgs).toLowerCase()).toContain(cavemanMarker);
  });

  it("bypasses all savers on X-DurinDoor-Token-Saver: off", async () => {
    await handleChatCore(baseRequest({ "x-durindoor-token-saver": "off" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(runCompressionSeamMock).not.toHaveBeenCalled();
    expect(dispatchedBody().messages).toEqual(makeMessages());
  });

  it("bypasses all savers on the legacy X-9Router-Token-Saver: off", async () => {
    await handleChatCore(baseRequest({ "x-9router-token-saver": "off" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(runCompressionSeamMock).not.toHaveBeenCalled();
    expect(dispatchedBody().messages).toEqual(makeMessages());
  });

  it("bypasses Ponytail slash commands on X-DurinDoor-Token-Saver: off (#2609)", async () => {
    // /ponytail-help normally returns a synthetic local response without any
    // upstream dispatch. With the bypass header off, the request must reach
    // the provider instead of being intercepted (Codex P2 on PR #270).
    const req = baseRequest({ "x-durindoor-token-saver": "off" });
    req.body.messages = [{ role: "user", content: "/ponytail-help" }];

    await handleChatCore(req);

    // Dispatched upstream — no synthetic local command response.
    expect(executeMock).toHaveBeenCalled();
    expect(dispatchedBody().messages).toEqual([{ role: "user", content: "/ponytail-help" }]);
  });

  it("keeps Ponytail slash commands when no bypass header is sent", async () => {
    const req = baseRequest({});
    req.body.messages = [{ role: "user", content: "/ponytail-help" }];

    const result = await handleChatCore(req);

    // Intercepted locally: upstream never sees the command.
    expect(executeMock).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  it("DurinDoor header wins over a conflicting legacy header", async () => {
    const req = baseRequest({
      "x-durindoor-token-saver": "on",
      "x-9router-token-saver": "off",
    });
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        return new Response(JSON.stringify({
          messages: [{ role: "user", content: "compressed" }],
          tokens_before: 100,
          tokens_after: 10,
          tokens_saved: 90,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handleChatCore(req);

    // Savers still ran: headroom fetch fired, seam executed, caveman injected.
    expect(global.fetch).toHaveBeenCalled();
    expect(runCompressionSeamMock).toHaveBeenCalled();
    expect(JSON.stringify(dispatchedBody().messages).toLowerCase()).toContain(cavemanMarker);
  });
});
