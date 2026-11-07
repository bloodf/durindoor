import "../translator/registerAll.js";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), afterAcquire: null }));

vi.mock("../../open-sse/services/concurrencyGate.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    acquireMany: async (...args) => {
      const release = await actual.acquireMany(...args);
      mocks.afterAcquire?.();
      return release;
    },
  };
});
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null, isNativePassthrough: () => false, isCodexOriginatedHeaders: () => false,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()), saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { _resetGates, acquireSlot, getGateStats, releaseSlot } = await import("../../open-sse/services/concurrencyGate.js");

afterEach(() => {
  mocks.afterAcquire = null;
  _resetGates();
  vi.clearAllMocks();
});

it("releases every acquired slot when disconnect wins before admission returns", async () => {
  const controller = new AbortController();
  let waiter;
  mocks.afterAcquire = () => {
    waiter = acquireSlot("openai", 1);
    waiter.catch(() => {});
    controller.abort();
  };
  const body = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }], stream: false };
  const result = await handleChatCore({
    body, modelInfo: { provider: "openai", model: "gpt-4o" }, credentials: { apiKey: "test" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    abortSignal: controller.signal, globalConcurrentRequests: 1, providerConcurrencyLimit: { openai: 1 },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() },
  });
  expect(result.status).toBe(499);
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(getGateStats()).toEqual({ openai: { current: 1, queued: 0 } });
  await waiter;
  releaseSlot("openai");
  expect(getGateStats()).toEqual({});
});
