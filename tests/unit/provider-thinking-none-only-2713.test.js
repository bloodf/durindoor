// Dashboard defaults must not turn a request without reasoning into a local 400.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: false, execute: mocks.execute, refreshCredentials: vi.fn(async () => null) }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null,
  isNativePassthrough: mocks.isNativePassthrough,
  isCodexOriginatedHeaders: () => false,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  startActiveSession: vi.fn(),
  updateActiveSession: vi.fn(),
  finishActiveSession: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const MODEL = "none-only-2713";
const messages = [{ role: "user", content: "hello" }];

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.execute.mockRejectedValue(new Error("stop after dispatch"));
});

const dispatch = (clientBody, mode, efforts = ["none"]) => {
  const body = { model: MODEL, messages, ...clientBody };
  return handleChatCore({
    body,
    modelInfo: { provider: "openai", model: MODEL },
    credentials: { apiKey: "test-key" },
    sourceFormatOverride: FORMATS.OPENAI,
    providerThinking: { mode },
    modelCapabilities: { reasoning: true, thinkingFormat: "openai", thinkingEfforts: efforts },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: "connection-2713",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
};

describe("provider thinking defaults on none-only models (#2713)", () => {
  it.each(["high", "on"])("skips provider %s and dispatches without effort", async (mode) => {
    await dispatch({}, mode).catch(() => {});
    expect(mocks.execute).toHaveBeenCalledOnce();
    const sent = mocks.execute.mock.calls[0][0].body;
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.reasoning).toBeUndefined();
    expect(sent.thinking).toBeUndefined();
  });

  it.each(["high", "on"])("still returns a local 400 for client high with provider %s", async (mode) => {
    const result = await dispatch({ reasoning_effort: "high" }, mode);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(JSON.stringify(await result.response.json())).toContain('Reasoning effort');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("still injects provider high on a normal reasoning model", async () => {
    await dispatch({}, "high", ["none", "low", "high"]).catch(() => {});
    expect(mocks.execute).toHaveBeenCalledOnce();
    const sent = mocks.execute.mock.calls[0][0].body;
    expect(sent.reasoning_effort ?? sent.reasoning?.effort).toBe("high");
  });
});
