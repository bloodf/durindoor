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
const { applyProviderThinkingOverride } = await import("../../open-sse/config/providerModels.js");

const MODEL = "claude-opus-4-6";

async function dispatch(clientBody, providerThinking) {
  const body = { model: MODEL, messages: [{ role: "user", content: "hi" }], ...clientBody };
  await handleChatCore({
    body,
    modelInfo: { provider: "github", model: MODEL },
    credentials: { apiKey: "test-key" },
    providerThinking,
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: "connection-2927",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  expect(mocks.execute).toHaveBeenCalled();
  return mocks.execute.mock.calls[0][0].body;
}

describe("provider thinking level against an unlevelled client intent (upstream 9router#2927)", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.execute.mockRejectedValue(new Error("stop after dispatch"));
    mocks.isNativePassthrough.mockReturnValue(false);
  });

  it.each([
    ["bare adaptive thinking", { thinking: { type: "adaptive" } }],
    ["bare enabled thinking", { thinking: { type: "enabled" } }],
    ["reasoning_effort auto", { reasoning_effort: "auto" }],
    ["reasoningEffort auto", { reasoningEffort: "auto" }],
    ["output_config effort auto", { output_config: { effort: "auto" } }],
  ])("applies the configured level over %s", async (_name, clientBody) => {
    const sent = await dispatch(clientBody, { mode: "low" });

    expect(sent.output_config.effort).toBe("low");
  });

  it("keeps a budget the client named", async () => {
    const sent = await dispatch({ thinking: { type: "enabled", budget_tokens: 1024 } }, { mode: "high" });

    expect(sent.output_config.effort).toBe("low");
  });

  it("keeps the client's thinking field on native passthrough", async () => {
    mocks.isNativePassthrough.mockReturnValue(true);

    const sent = await dispatch({ thinking: { type: "adaptive" } }, { mode: "low" });

    expect(sent.thinking).toMatchObject({ type: "adaptive" });
  });

  it("leaves other output_config keys and the caller's body untouched", () => {
    const body = { output_config: { effort: "auto", format: { type: "json_schema" } } };

    expect(applyProviderThinkingOverride(body, { mode: "medium" })).toEqual({
      output_config: { format: { type: "json_schema" } },
      reasoning_effort: "medium",
    });
    expect(body.output_config.effort).toBe("auto");
  });

  it("does not replace between_tools, which names a thinking mode", () => {
    const body = { thinking: { type: "between_tools" } };

    expect(applyProviderThinkingOverride(body, { mode: "low" }).thinking).toEqual({ type: "between_tools" });
  });
});
