// OmniRoute #20335: operators name providers that reject Claude's `type: "custom"`.
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), saveRequestUsage: vi.fn(() => Promise.resolve()), appendRequestLog: vi.fn(() => Promise.resolve()), saveRequestDetail: vi.fn(() => Promise.resolve()),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const ENV = "DURINDOOR_CLAUDE_TOOL_TYPE_REJECTING_PROVIDERS";
const GATEWAY = "anthropic-compatible-rejecting";
const schema = { type: "object", properties: {} };
const TOOLS = [
  { type: "custom", name: "lookup", input_schema: schema },
  { name: "typeless", input_schema: schema },
  { type: "web_search_20250305", name: "web_search" },
];

async function dispatchedTools(provider, requested = TOOLS) {
  mocks.execute.mockReset().mockResolvedValue({
    response: new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } }),
    url: "https://gateway.invalid/v1/messages", headers: {}, transformedBody: {},
  });
  const body = { model: "claude-test", max_tokens: 16, stream: false, messages: [{ role: "user", content: "hi" }], tools: structuredClone(requested) };
  await handleChatCore({
    body, modelInfo: { provider, model: "claude-test" }, credentials: { apiKey: "synthetic", providerSpecificData: { baseUrl: "https://gateway.invalid/v1" } },
    clientRawRequest: { endpoint: "/v1/messages", body, headers: {} }, sourceFormatOverride: "claude", connectionId: "tool-type-test",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
  expect(mocks.execute).toHaveBeenCalledOnce();
  return mocks.execute.mock.calls[0][0].body.tools;
}
// MiniMax is refused before dispatch when a request carries an Anthropic server tool.
const CLIENT_TOOLS = TOOLS.slice(0, 2);
const typesByName = (tools) => Object.fromEntries(tools.map((tool) => [tool.name, tool.type ?? null]));

describe("port(omniroute): #20335 configured providers drop only the custom tool discriminator", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("strips type:custom for a listed provider and keeps every other tool field", async () => {
    vi.stubEnv(ENV, ` other , ${GATEWAY},, `);
    const tools = await dispatchedTools(GATEWAY);
    expect(typesByName(tools)).toEqual({ lookup: null, typeless: null, web_search: "web_search_20250305" });
    expect(tools[0].input_schema).toEqual(schema);
  });

  it("wins over the requireClaudeToolType default for a listed provider", async () => {
    vi.stubEnv(ENV, "minimax");
    expect((await dispatchedTools("minimax", CLIENT_TOOLS)).some((tool) => tool.type === "custom")).toBe(false);
  });

  it.each([
    ["unset", undefined],
    ["naming another provider", "anthropic-compatible-other"],
  ])("changes nothing when the list is %s", async (_label, value) => {
    vi.stubEnv(ENV, value);
    expect(typesByName(await dispatchedTools(GATEWAY))).toEqual({ lookup: "custom", typeless: null, web_search: "web_search_20250305" });
    expect(typesByName(await dispatchedTools("anthropic"))).toMatchObject({ lookup: "custom" });
  });

  it("leaves the MiniMax default alone when it is not listed", async () => {
    vi.stubEnv(ENV, GATEWAY);
    expect(typesByName(await dispatchedTools("minimax", CLIENT_TOOLS))).toMatchObject({ typeless: "custom" });
  });
});
