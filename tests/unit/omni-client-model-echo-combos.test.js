import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1073 (OmniRoute #18495): the response-model echo must report the model the
 * CLIENT selected, never the combo leaf the request was dispatched to.
 *
 * DurinDoor already honours that for the two paths that promise it (Codex
 * Responses lifecycle/unary echo, Claude `message_start` echo): the echo id is
 * read from the client snapshot (`clientRawRequest.body.model` /
 * `clientRawRequest.originalModel`) captured in `handleChat` before any combo
 * or alias rewriting. These tests drive the real `handleChat` → combo →
 * `handleSingleModelChat` → `handleChatCore` chain offline (executor and
 * stream-shaping handlers stubbed, no network, no credentials) so the
 * divergence between the client id and the routed leaf is exercised end to end.
 */

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  isExactRoutableModelId: vi.fn(),
  getProviderCredentials: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  loadCustomCapabilities: vi.fn(),
  warmLiveModelLimits: vi.fn(),
  resolveClientApiKey: vi.fn(),
  execute: vi.fn(),
  logRawRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...(await importOriginal()),
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  getComboCanonicalName: vi.fn(async (name) => (name === "team/echo-combo" ? name : null)),
  createRoutableModelIdChecker: vi.fn(() => mocks.isExactRoutableModelId),
  loadCustomCapabilities: mocks.loadCustomCapabilities,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "sk-test"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true, stored: true })),
  resolveClientApiKey: mocks.resolveClientApiKey,
  isProviderConnectionModelLocked: vi.fn(() => false),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/services/liveModelLimits.js", async (importOriginal) => ({
  ...(await importOriginal()),
  warmLiveModelLimits: mocks.warmLiveModelLimits,
}));
vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: false,
    execute: mocks.execute,
    refreshCredentials: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: mocks.logRawRequest,
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  })),
}));
// Pass the provider response straight through so the assertions observe the
// echo boundary in chatCore (`finalizeResponse`), not translator behaviour.
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: vi.fn(async ({ providerResponse }) => ({ success: true, response: providerResponse })),
}));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: vi.fn(async ({ providerResponse }) => ({ success: true, response: providerResponse })),
}));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  trackPendingRequest: vi.fn(),
  appendRequestLog: mocks.appendRequestLog,
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

// Private, throwaway data dir: the few unmocked localDb readers hit an empty
// store, never the operator's ~/.9router. Set before any module import below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-echo-combos-"));
process.env.DATA_DIR = dataDir;

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const {
  applyClaudeResponseModelEcho,
  applyResponseModelEcho,
  resolveClaudeEchoModel,
  resolveResponsesEchoModel,
} = await import("../../open-sse/services/responseModelEcho.js");

const COMBO = "team/echo-combo";
const FIRST_LEAF = "openai/gpt-first";
const SECOND_LEAF = "codex/gpt-second";
const SERVED_MODEL = "gpt-second";

function sse(frames) {
  return frames.join("\n\n") + "\n\n";
}

function responsesStream(model) {
  return sse([
    `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", object: "response", model, status: "in_progress" } })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", object: "response", model, status: "completed", output: [] } })}`,
    "data: [DONE]",
  ]);
}

function claudeStream(model) {
  return sse([
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } })}`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
  ]);
}

function chatStream(model) {
  return sse([
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }] })}`,
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
  ]);
}

function providerReply(body, { contentType = "text/event-stream", status = 200, model = SERVED_MODEL } = {}) {
  return {
    response: new Response(body, { status, headers: { "Content-Type": contentType } }),
    url: "https://provider.test/v1",
    headers: {},
    transformedBody: { model },
  };
}

function failingReply() {
  return providerReply(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
    contentType: "application/json",
    status: 503,
    model: "gpt-first",
  });
}

function comboRequest({ url, headers = {}, body }) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test", ...headers },
    body: JSON.stringify(body),
  });
}

function responsesRequest({ stream, model = COMBO, headers = { originator: "codex_exec" } }) {
  return comboRequest({
    url: "http://localhost/v1/responses",
    headers,
    body: { model, stream, input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] },
  });
}

function claudeRequest({ model = COMBO }) {
  return comboRequest({
    url: "http://localhost/v1/messages",
    headers: { "anthropic-version": "2023-06-01" },
    body: { model, stream: true, max_tokens: 64, messages: [{ role: "user", content: "hello" }] },
  });
}

function chatRequest({ model = COMBO }) {
  return comboRequest({
    url: "http://localhost/v1/chat/completions",
    body: { model, stream: true, messages: [{ role: "user", content: "hello" }] },
  });
}

function modelsDispatched() {
  return mocks.execute.mock.calls.map(([args]) => args.model);
}

describe("client-selected model echo through combos (#1073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      comboStickyRoundRobinLimit: 0,
      hidePaidModels: false,
    });
    mocks.getApiKeyByKey.mockResolvedValue({ id: "key-id", key: "sk-test", allowedModels: null, allowedCombos: null });
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.getApiKeyUsageTotals.mockResolvedValue({});
    mocks.isExactRoutableModelId.mockResolvedValue(false);
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.loadCustomCapabilities.mockResolvedValue(null);
    mocks.getProviderCredentials.mockImplementation(async (provider) => ({
      apiKey: "k",
      connectionId: `${provider}-conn`,
      providerSpecificData: {},
    }));
    mocks.warmLiveModelLimits.mockReturnValue(undefined);
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "sk-test", auth: { ok: true, stored: true } });
    // The combo name is not a concrete model; its members resolve to leaves.
    mocks.getComboModels.mockImplementation(async (name) => (name === COMBO ? [FIRST_LEAF, SECOND_LEAF] : null));
    mocks.getModelInfo.mockImplementation(async (name) => {
      if (name === COMBO) return { provider: null, model: name };
      const [provider, ...rest] = String(name).split("/");
      return { provider, model: rest.join("/") };
    });
  });

  it("Responses stream: echoes the combo id after failover while dispatch and accounting keep the served leaf", async () => {
    mocks.execute
      .mockResolvedValueOnce(failingReply())
      .mockResolvedValueOnce(providerReply(responsesStream(SERVED_MODEL)));

    const response = await handleChat(responsesRequest({ stream: true }));
    const text = await response.text();

    expect(response.status).toBe(200);
    // Failover really happened: both leaves were dispatched, in order, by leaf id.
    expect(modelsDispatched()).toEqual(["gpt-first", SERVED_MODEL]);
    const lifecycle = [...text.matchAll(/^data: (\{.*\})$/gm)]
      .map((m) => JSON.parse(m[1]))
      .filter((e) => e.type === "response.created" || e.type === "response.completed");
    expect(lifecycle.map((e) => e.type)).toEqual(["response.created", "response.completed"]);
    for (const event of lifecycle) expect(event.response.model).toBe(COMBO);
    expect(text).not.toContain(`"model":"${SERVED_MODEL}"`);
    // Non-lifecycle frames and the terminator are untouched.
    expect(text).toContain('"type":"response.output_text.delta","delta":"ok"');
    expect(text).toContain("data: [DONE]");
    // Accounting/diagnostic identity is the served member, not the client id.
    expect(mocks.logRawRequest).toHaveBeenLastCalledWith(expect.objectContaining({ model: SERVED_MODEL }));
    const served = mocks.appendRequestLog.mock.calls.map(([entry]) => entry).filter((entry) => entry.provider === "codex");
    expect(served.length).toBeGreaterThan(0);
    for (const entry of served) expect(entry.model).toBe(SERVED_MODEL);
    for (const [entry] of mocks.appendRequestLog.mock.calls) expect(entry.model).not.toBe(COMBO);
  });

  it("Responses unary JSON: sets the combo id on the body returned by the served member", async () => {
    mocks.execute.mockResolvedValueOnce(failingReply()).mockResolvedValueOnce(
      providerReply(
        JSON.stringify({ id: "resp_1", object: "response", model: SERVED_MODEL, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }] }),
        { contentType: "application/json" },
      ),
    );

    const response = await handleChat(responsesRequest({ stream: false }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(modelsDispatched()).toEqual(["gpt-first", SERVED_MODEL]);
    expect(json.model).toBe(COMBO);
    expect(json.id).toBe("resp_1");
    expect(response.headers.has("content-length")).toBe(false);
  });

  it("Responses without a Codex-originated header keeps the existing upstream visibility", async () => {
    mocks.execute.mockResolvedValueOnce(failingReply()).mockResolvedValueOnce(providerReply(responsesStream(SERVED_MODEL)));

    const response = await handleChat(responsesRequest({ stream: true, headers: { "user-agent": "plain-sdk/1.0" } }));
    const text = await response.text();

    expect(text).toContain(`"model":"${SERVED_MODEL}"`);
    expect(text).not.toContain(COMBO);
  });

  it("Claude stream: echoes the original alias in message_start after failover", async () => {
    mocks.execute
      .mockResolvedValueOnce(failingReply())
      .mockResolvedValueOnce(providerReply(claudeStream(SERVED_MODEL)));

    const response = await handleChat(claudeRequest({}));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(modelsDispatched()).toEqual(["gpt-first", SERVED_MODEL]);
    const start = JSON.parse(text.match(/event: message_start\ndata: (\{.*\})/)[1]);
    expect(start.message.model).toBe(COMBO);
    expect(text).not.toContain(`"model":"${SERVED_MODEL}"`);
    // Other events are left alone.
    expect(text).toContain('"type":"text_delta","text":"ok"');
    expect(text).toContain('"type":"message_stop"');
    for (const [entry] of mocks.appendRequestLog.mock.calls) expect(entry.model).not.toBe(COMBO);
  });

  it("Chat Completions does not promise an echo and keeps its existing visibility", async () => {
    mocks.execute
      .mockResolvedValueOnce(failingReply())
      .mockResolvedValueOnce(providerReply(chatStream(SERVED_MODEL)));

    const response = await handleChat(chatRequest({}));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain(`"model":"${SERVED_MODEL}"`);
    expect(text).not.toContain(COMBO);
  });

  it("direct (non-combo) Codex alias still echoes the client id while dispatching the resolved model", async () => {
    mocks.getModelInfo.mockImplementation(async () => ({ provider: "codex", model: "gpt-6.1-sol" }));
    mocks.execute.mockResolvedValueOnce(providerReply(responsesStream("gpt-6.1-sol"), { model: "gpt-6.1-sol" }));

    const response = await handleChat(responsesRequest({ stream: true, model: "codex/gpt-6.1-sol-xhigh" }));
    const text = await response.text();

    expect(text).toContain('"model":"codex/gpt-6.1-sol-xhigh"');
    expect(text).not.toContain('"model":"gpt-6.1-sol"');
    expect(modelsDispatched()).toEqual(["gpt-6.1-sol"]);
  });
});

describe("handleChatCore echo source when the routed body diverges from the client snapshot (#1073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function coreOptions({ clientModel, routedModel, format, headers }) {
    const messages = [{ role: "user", content: "hello" }];
    const clientBody = format === "claude"
      ? { model: clientModel, stream: true, max_tokens: 64, messages }
      : { model: clientModel, stream: true, input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] };
    return {
      // What combo dispatch hands over: the body model is already the leaf.
      body: { ...clientBody, model: routedModel },
      modelInfo: { provider: "openai", model: "gpt-5.5" },
      credentials: { apiKey: "k", providerSpecificData: {} },
      connectionId: "conn",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      sourceFormatOverride: format === "claude" ? "claude" : "openai-responses",
      clientRawRequest: {
        endpoint: format === "claude" ? "/v1/messages" : "/v1/responses",
        body: clientBody,
        originalModel: clientModel,
        headers,
      },
    };
  }

  it("Responses: echo comes from the client snapshot even though body.model is the leaf", async () => {
    mocks.execute.mockResolvedValue(providerReply(responsesStream("gpt-5.5"), { model: "gpt-5.5" }));

    const result = await handleChatCore(coreOptions({
      clientModel: "team/alias-combo",
      routedModel: "openai/gpt-5.5",
      format: "responses",
      headers: { originator: "codex_exec", accept: "text/event-stream" },
    }));
    const text = await result.response.text();

    expect(text).toContain('"model":"team/alias-combo"');
    expect(text).not.toContain('"model":"gpt-5.5"');
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));
    expect(mocks.appendRequestLog).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5", provider: "openai" }));
  });

  it("Responses: no snapshot model means nothing is echoed, never the routed id", async () => {
    mocks.execute.mockResolvedValue(providerReply(responsesStream("gpt-5.5"), { model: "gpt-5.5" }));
    const options = coreOptions({
      clientModel: "team/alias-combo",
      routedModel: "openai/gpt-5.5",
      format: "responses",
      headers: { originator: "codex_exec", accept: "text/event-stream" },
    });
    options.clientRawRequest.body = { ...options.clientRawRequest.body, model: undefined };

    const result = await handleChatCore(options);
    const text = await result.response.text();

    expect(text).toContain('"model":"gpt-5.5"');
    expect(text).not.toContain("openai/gpt-5.5");
    expect(text).not.toContain("team/alias-combo");
  });

  it("Claude: echo comes from originalModel even though body.model is the leaf", async () => {
    mocks.execute.mockResolvedValue(providerReply(claudeStream("gpt-5.5"), { model: "gpt-5.5" }));

    const result = await handleChatCore(coreOptions({
      clientModel: "claude-fast[1m]",
      routedModel: "gpt-5.5",
      format: "claude",
      headers: { accept: "text/event-stream", "anthropic-version": "2023-06-01" },
    }));
    const text = await result.response.text();

    expect(JSON.parse(text.match(/event: message_start\ndata: (\{.*\})/)[1]).message.model).toBe("claude-fast[1m]");
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));
    expect(mocks.appendRequestLog).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5", provider: "openai" }));
  });
});

describe("echo id resolution is independent of routed identity (#1073)", () => {
  it("prefers the client snapshot and never falls back to a routed id", () => {
    expect(resolveResponsesEchoModel({ body: { model: "team/alias" }, routedModel: "openai/gpt-5.5" })).toBe("team/alias");
    expect(resolveResponsesEchoModel({ body: {}, routedModel: "openai/gpt-5.5" })).toBeNull();
    expect(resolveClaudeEchoModel({ originalModel: "claude-fast[1m]", body: { model: "gpt-5.5" } })).toBe("claude-fast[1m]");
    expect(resolveClaudeEchoModel({ body: { model: "gpt-5.5" } })).toBeNull();
  });

  it("returns results untouched when there is no echo id or the result failed", async () => {
    const failed = { success: false, response: new Response("nope", { status: 502 }) };
    expect(await applyResponseModelEcho(failed, "team/alias")).toBe(failed);
    expect(applyClaudeResponseModelEcho(failed, "team/alias")).toBe(failed);
    const ok = { success: true, response: new Response("{}", { headers: { "Content-Type": "application/json" } }) };
    expect(await applyResponseModelEcho(ok, null)).toBe(ok);
    expect(applyClaudeResponseModelEcho(ok, null)).toBe(ok);
  });
});
