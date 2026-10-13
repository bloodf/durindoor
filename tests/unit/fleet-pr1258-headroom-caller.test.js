import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Block sockets before loading the real translator/provider registration graph.
const local = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  const originalKimchi = globalThis.__kimchi_ua_state;
  globalThis.__kimchi_ua_state = {
    currentAgent: "kimchi/local-fixture",
    lastFetchTime: Date.now(),
    activePromise: null,
    intervalStarted: true,
  };
  const fetch = vi.fn(async () => { throw new Error("Unexpected fixture transport"); });
  globalThis.fetch = fetch;
  return { originalFetch, originalKimchi, fetch, execute: vi.fn(), dispatches: [], compressions: [], unexpected: [] };
});

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: local.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logOpenAIRequest: vi.fn(), logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
  maskSensitiveUrl: (url) => url,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/repos/proxyTimelineRepo.js", () => ({
  startTrace: vi.fn(() => null), record: vi.fn(), finishTrace: vi.fn(),
}));

// These imports register the actual direct Claude/Kiro and OpenAI pivot routes.
await import("../../open-sse/translator/index.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { compressWithHeadroom, resetHeadroomCircuit } = await import("../../open-sse/rtk/headroom.js");

const MODEL = "claude-sonnet-4-6";
const PERSONA = "You are a local fixture archivist. Preserve the caller persona.";
const SHORT_CONTEXT = "short fixture context";
const CONTINUATION = "Continue from the assistant response above without repeating it.";
const readable = { type: "thinking", thinking: "Readable fixture reasoning before redaction.", signature: "Eg==" };
const opaque = [
  { type: "redacted_thinking", data: "AAECAwQF+/==" },
  { type: "redacted_thinking", data: "" },
  { type: "redacted_thinking", data: "opaque-fixture-2/+=\u0000\n" },
];
const histories = [
  ["mixed", [readable, opaque[0], opaque[1],
    { ...readable, thinking: "Readable fixture reasoning between redactions." },
    opaque[2], { type: "text", text: "Fixture answer." }]],
  ["opaque-only", opaque],
  ["empty-opaque", [opaque[1]]],
];
const policies = [
  ["default", {}],
  ["preserve", { "x-9router-assistant-prefill": "preserve" }],
];
const nativeCases = histories.flatMap(([shape, blocks]) => policies.flatMap(([policy, headers]) =>
  [false, true].map((userEnded) => ({ shape, blocks, policy, headers, userEnded }))));
const incompatibleCases = [
  ["gemini", "gemini-2.5-flash", "to Gemini"],
  ["kiro", MODEL, "to Kiro"],
].flatMap(([provider, model, route]) => histories.flatMap(([shape, blocks]) =>
  policies.map(([policy, headers]) => ({ provider, model, route, shape, blocks, policy, headers }))));

function fixture(blocks, userEnded = false) {
  return {
    model: MODEL, stream: false, max_tokens: 4096,
    thinking: { type: "enabled", budget_tokens: 1024 }, system: PERSONA,
    messages: [
      { role: "user", content: [{ type: "text", text: "Archive fixture context. ".repeat(256) }] },
      { role: "assistant", content: structuredClone(blocks) },
      ...(userEnded ? [{ role: "user", content: [{ type: "text", text: "Continue fixture." }] }] : []),
    ],
  };
}

function systemText(system) {
  return typeof system === "string" ? system : system.map((block) => block.text).join("\n");
}

function wireBytes(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

// Native dispatch adds cache metadata to text, not conversation content.
function withoutCache(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "cache_control" ? undefined : item));
}

async function callCore(body, headers = {}, provider = "claude", model = MODEL) {
  const snapshot = structuredClone(body);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const onHeadroomEvent = vi.fn();
  const result = await handleChatCore({
    body, modelInfo: { provider, model },
    credentials: { providerSpecificData: {} }, connectionId: "local-pr1258-caller",
    log, onHeadroomEvent, sourceFormatOverride: "claude",
    headroomEnabled: true, headroomUrl: "http://localhost:8787",
    headroomCompressUserMessages: true,
    rtkEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    pxpipeEnabled: false, compressionEnabled: false, skipPonytailCommands: true,
    clientRawRequest: {
      endpoint: "/v1/messages", body: snapshot,
      headers: { accept: "application/json", "user-agent": "claude-code/local-fixture", ...headers },
    },
  });
  expect(local.unexpected).toEqual([]);
  return { result, snapshot, log, onHeadroomEvent };
}

describe("PR #1258 real chatCore Headroom caller continuity", () => {
  beforeEach(() => {
    resetHeadroomCircuit();
    vi.clearAllMocks();
    local.dispatches.length = 0;
    local.compressions.length = 0;
    local.unexpected.length = 0;
    local.fetch.mockImplementation(async (url, options) => {
      if (String(url) !== "http://localhost:8787/v1/compress") {
        local.unexpected.push(String(url));
        throw new Error(`Unexpected fixture transport: ${url}`);
      }
      const request = JSON.parse(options.body);
      const response = {
        messages: request.messages.map((message) => ({
          ...message, ...(message.role === "user" ? { content: SHORT_CONTEXT } : {}),
        })),
        tokens_before: 4096, tokens_after: 256, tokens_saved: 3840,
      };
      local.compressions.push({ request, response });
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    });
    local.execute.mockImplementation(async (args) => {
      local.dispatches.push(structuredClone(args.body));
      return {
        response: new Response(JSON.stringify({
          id: "msg_local_fixture", type: "message", role: "assistant", model: MODEL,
          content: [{ type: "text", text: "Local fixture response." }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 32, output_tokens: 8 },
        }), { headers: { "content-type": "application/json" } }),
        url: "http://localhost/provider-fixture", headers: {}, transformedBody: args.body,
      };
    });
  });

  afterAll(() => {
    globalThis.fetch = local.originalFetch;
    if (local.originalKimchi === undefined) delete globalThis.__kimchi_ua_state;
    else globalThis.__kimchi_ua_state = local.originalKimchi;
  });

  it.each(nativeCases)("preserves $shape bytes/signatures/persona under $policy prefill, user-ended=$userEnded", async ({ blocks, policy, headers, userEnded }) => {
    const { result, snapshot, onHeadroomEvent, log } = await callCore(fixture(blocks, userEnded), headers);
    expect(result.response.status).toBe(200);
    expect(local.execute).toHaveBeenCalledTimes(1);
    expect(local.fetch).not.toHaveBeenCalled();
    expect(local.compressions).toEqual([]);
    expect(onHeadroomEvent).toHaveBeenCalledWith(expect.objectContaining({ applied: false, reason: "translation-failed" }));
    expect(log.warn).toHaveBeenCalledWith("HEADROOM", expect.stringContaining("redacted_thinking"));
    const outbound = local.dispatches[0];
    const assistant = outbound.messages.find((message) => message.role === "assistant");
    expect(withoutCache(assistant.content)).toEqual(snapshot.messages[1].content);
    const thinkingBlocks = (content) => content.filter((block) => block.type === "thinking" || block.type === "redacted_thinking");
    expect(wireBytes(thinkingBlocks(assistant.content))).toEqual(wireBytes(thinkingBlocks(snapshot.messages[1].content)));
    expect(withoutCache(outbound.messages.slice(0, snapshot.messages.length))).toEqual(snapshot.messages);
    expect(systemText(outbound.system)).toBe(PERSONA);
    if (!userEnded && policy === "default") {
      expect(outbound.messages).toHaveLength(snapshot.messages.length + 1);
      expect(withoutCache(outbound.messages.at(-1))).toEqual({ role: "user", content: [{ type: "text", text: CONTINUATION }] });
    } else {
      expect(outbound.messages).toHaveLength(snapshot.messages.length);
      expect(outbound.messages.at(-1).role).toBe(userEnded ? "user" : "assistant");
    }
  });

  it.each(policies)("preserves signed readable thinking and persona through successful Headroom roundtrip (%s)", async (_policy, headers) => {
    const { result, snapshot, onHeadroomEvent } = await callCore(fixture([
      readable, { type: "text", text: "Fixture answer." },
    ], true), headers);
    expect(result.response.status).toBe(200);
    expect(local.fetch).toHaveBeenCalledTimes(1);
    expect(local.execute).toHaveBeenCalledTimes(1);
    expect(local.compressions[0].request.config).toEqual({ compress_user_messages: true });
    expect(local.compressions[0].request.messages.find((message) => message.role === "assistant").reasoning_content).toBe(readable.thinking);
    expect(onHeadroomEvent).toHaveBeenCalledTimes(1);
    const event = onHeadroomEvent.mock.calls[0][0];
    expect(event).toMatchObject({ applied: true, tokensBefore: 4096, tokensAfter: 256, tokensSaved: 3840 });
    expect(event.bodyBytesAfter).toBeLessThan(event.bodyBytesBefore * 0.95);
    const outbound = local.dispatches[0];
    expect(wireBytes(outbound).length).toBeLessThan(wireBytes(snapshot).length * 0.95);
    expect(outbound.messages[0].content).toEqual([{ type: "text", text: SHORT_CONTEXT }]);
    expect.soft(withoutCache(outbound.messages[1].content)).toEqual(snapshot.messages[1].content);
    expect.soft(systemText(outbound.system)).toBe(PERSONA);
  });

  it("preserves ordered native system instructions and signed blocks on writeback", async () => {
    const body = { ...fixture([readable, { type: "text", text: "Fixture answer." }], true),
      system: [{ type: "text", text: PERSONA }, { type: "text", text: "Second instruction.", cache_control: { type: "ephemeral" } }],
    };
    const original = structuredClone(body);
    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: MODEL, format: "claude" });
    expect(stats).not.toBeNull();
    expect(body.system).toEqual(original.system);
    expect(wireBytes(body.messages[1])).toEqual(wireBytes(original.messages[1]));
    expect(body.messages[0].content).toEqual([{ type: "text", text: SHORT_CONTEXT }]);
  });

  it.each(["assistant", "system"])("fails open when compression changes projected %s content", async (role) => {
    const body = fixture([readable, { type: "text", text: "Fixture answer." }], true);
    const original = structuredClone(body);
    local.fetch.mockImplementationOnce(async (_url, options) => {
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        messages: request.messages.map((message) => ({ ...message,
          content: message.role === role ? "changed protected content" : message.role === "user" ? SHORT_CONTEXT : message.content,
        })), tokens_before: 4096, tokens_after: 256, tokens_saved: 3840,
      }));
    });
    const diagnostics = {};
    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: MODEL, format: "claude", diagnostics })).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toContain("changed Claude assistant or system content");
  });

  it("fails open without flattening native user tool results", async () => {
    const body = fixture([readable], true);
    body.messages[0].content = [{ type: "tool_result", tool_use_id: "fixture-tool", content: "Native result." }];
    const original = structuredClone(body);
    expect(await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", model: MODEL, format: "claude" })).toBeNull();
    expect(body).toEqual(original);
    expect(local.fetch).not.toHaveBeenCalled();
  });

  it.each(incompatibleCases)("rejects registered $provider $shape route before dispatch under $policy prefill", async ({ provider, model, route, blocks, headers }) => {
    const { result } = await callCore(fixture(blocks, true), headers, provider, model);
    expect(result.response.status).toBe(400);
    const error = await result.response.json();
    expect(JSON.stringify(error)).toContain(`Cannot translate redacted_thinking ${route}`);
    expect(local.execute).not.toHaveBeenCalled();
    expect(local.dispatches).toEqual([]);
    expect(local.fetch).not.toHaveBeenCalled();
  });
});
