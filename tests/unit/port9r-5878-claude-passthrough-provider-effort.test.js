import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function outbound(headers, providerThinking, extra = {}) {
  const model = "claude-sonnet-4-6";
  const body = { model, max_tokens: 1024, messages: [{ role: "user", content: "hello" }], stream: false, ...extra };
  await handleChatCore({
    body,
    modelInfo: { provider: "claude", model },
    credentials: { accessToken: "test", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "port9r-5878",
    providerThinking,
    sourceFormatOverride: "claude",
    clientRawRequest: { endpoint: "/v1/messages", body, headers },
  });
  return mocks.execute.mock.calls.at(-1)[0].body;
}

describe("upstream 9router #5878 - Claude native passthrough provider effort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in unit tests"); }));
    mocks.execute.mockRejectedValue(new Error("stop after outbound capture"));
  });

  it.each([{ "user-agent": "claude-cli/2.1.323" }, { "x-app": "cli" }])("converts the configured effort for %j", async (headers) => {
    const body = await outbound(headers, { mode: "high" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.output_config?.effort).toBe("high");
  });

  it("keeps explicit Claude effort instead of overriding it", async () => {
    const body = await outbound({ "x-app": "cli" }, { mode: "high" }, { output_config: { effort: "low" } });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.output_config.effort).toBe("low");
  });

  it("preserves other output configuration while converting the provider setting", async () => {
    const format = { type: "json_schema", schema: { type: "object" } };
    const body = await outbound({ "x-app": "cli" }, { mode: "high" }, { output_config: { format } });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "high", format });
  });

  it("keeps explicit thinking and leaves requests without an override unchanged", async () => {
    const explicit = await outbound({ "x-app": "cli" }, { mode: "high" }, { thinking: { type: "disabled" } });
    expect(explicit.thinking).toEqual({ type: "disabled" });
    expect(explicit.reasoning_effort).toBeUndefined();
    const plain = await outbound({ "x-app": "cli" }, null);
    expect(plain.reasoning_effort).toBeUndefined();
    expect(plain.output_config?.effort).toBeUndefined();
  });
});
