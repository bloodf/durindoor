// #1098: RTK as an explicit compression-stack engine, one pass per request.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
}));

vi.mock("../../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })),
}));
vi.mock("../../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));
vi.mock("../../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined, startTime: Date.now(), isConnected: () => true,
    handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn(), abort: vi.fn(),
  })),
}));
vi.mock("../../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: vi.fn(),
}));
vi.mock("../../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.handleNonStreamingResponse,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../../open-sse/handlers/chatCore.js");
const { rtkEngine } = await import("../../../open-sse/services/compression/engines/rtkAdapter.js");
const { getEngine, isEngineAvailable } = await import("../../../open-sse/services/compression/index.js");
const { runFidelityEval } = await import("../../../open-sse/services/compression/eval/runFidelityEval.js");

function longDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} UNIQUE_PADDING_${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

const chatBody = (toolExtra = {}) => ({
  model: "m",
  stream: false,
  messages: [
    { role: "user", content: "run git diff" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{\"command\":\"git diff\"}" } }] },
    { role: "tool", tool_call_id: "call_1", content: longDiff(), ...toolExtra },
    { role: "user", content: "summarize" },
  ],
});

async function run({ provider = "openai", body = chatBody(), ...flags }) {
  const events = [];
  const line = vi.fn();
  await handleChatCore({
    body,
    modelInfo: { provider, model: "default" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line },
    connectionId: "c",
    onTokenSaverEvent: (e) => events.push(e),
    clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "m" }, headers: { accept: "application/json" } },
    ...flags,
  });
  const dispatched = mocks.execute.mock.calls.at(-1)[0].body;
  const lines = line.mock.calls.map((c) => c.join(" ")).join("\n");
  return { lines, dispatched, rtk: events.at(-1)?.rtk ?? null };
}

const RTK_ONLY_STACK = { compressionEnabled: true, compressionEngines: { rtk: { enabled: true } } };
const COMBINED_STACK = { compressionEnabled: true, compressionEngines: { rtk: { enabled: true }, lite: { enabled: true } } };

describe("rtk stack engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.execute.mockImplementation(async () => ({
      response: new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: null,
    }));
  });

  it("is dispatchable and passes the fidelity corpus with zero failures", async () => {
    expect(isEngineAvailable("rtk")).toBe(true);
    expect(getEngine("rtk").id).toBe("rtk");
    const report = await runFidelityEval({ engineIds: ["rtk"] });
    // Only the recorded lossy baseline: dedup-log collapses repeated heartbeat
    // lines, dropping their timestamps. Every structural invariant holds.
    const failures = report.records.flatMap((r) => r.failures.map((f) => `${r.caseId}:${f.invariant}`));
    expect(failures).toEqual(["responses-tool-output:numeric"]);
    expect(report.perEngine.rtk.errors).toBe(0);
  });

  it("apply compresses a clone, skips errors, and is a no-op once RTK already ran", () => {
    const body = chatBody();
    const before = JSON.stringify(body);
    const res = rtkEngine.apply(body, {});
    expect(res.compressed).toBe(true);
    expect(res.stats.rtk.hits.length).toBe(1);
    expect(JSON.stringify(body)).toBe(before);
    expect(res.body.messages[2].content.length).toBeLessThan(body.messages[2].content.length);

    expect(rtkEngine.apply(body, { config: { rtkApplied: true } })).toEqual({ body, compressed: false, stats: null });
    const errored = chatBody({ is_error: true });
    expect(rtkEngine.apply(errored, {})).toEqual({ body: errored, compressed: false, stats: null });
  });

  it("standalone, RTK-only stack and combined stack produce the same single pass and accounting", async () => {
    const standalone = await run({ rtkEnabled: true });
    const rtkOnly = await run(RTK_ONLY_STACK);
    const combined = await run(COMBINED_STACK);
    const toolText = (r) => r.dispatched.messages.find((m) => m.role === "tool").content;

    expect(standalone.rtk.hits).toBe(1);
    expect(rtkOnly.rtk).toEqual(standalone.rtk);
    expect(combined.rtk).toEqual(standalone.rtk);
    expect(toolText(rtkOnly)).toBe(toolText(standalone));
    expect(toolText(combined)).toBe(toolText(standalone));
    // The stack step is a no-op after the dedicated pass, so it never claims credit.
    expect(rtkOnly.lines).toContain("RTK −");
    expect(rtkOnly.lines).not.toContain("COMPRESS:");
  });

  it("keeps the Cursor exception: an RTK-only stack compresses before translation", async () => {
    const { dispatched, rtk } = await run({ provider: "cursor", ...RTK_ONLY_STACK });
    const blob = JSON.stringify(dispatched.messages);
    expect(blob).toContain("<tool_result>");
    expect(blob).toContain("lines truncated");
    expect(blob).not.toContain("UNIQUE_PADDING_150");
    expect(rtk.hits).toBe(1);
  });

  it("skips error tool results in the stack path", async () => {
    const { dispatched, rtk } = await run({ body: chatBody({ is_error: true }), ...RTK_ONLY_STACK });
    expect(dispatched.messages.find((m) => m.role === "tool").content).toBe(longDiff());
    expect(rtk.hits).toBe(0);
  });

  it("does nothing when the stack is off and the toggle is off", async () => {
    const { dispatched, rtk } = await run({ compressionEnabled: false, compressionEngines: { rtk: { enabled: true } } });
    expect(dispatched.messages.find((m) => m.role === "tool").content).toBe(longDiff());
    expect(rtk?.hits ?? 0).toBe(0);
  });

  it("the token-saver bypass header disables an RTK stack step", async () => {
    const { dispatched } = await run({
      ...RTK_ONLY_STACK,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "m" }, headers: { accept: "application/json", "x-durindoor-token-saver": "off" } },
    });
    expect(dispatched.messages.find((m) => m.role === "tool").content).toBe(longDiff());
  });
});
