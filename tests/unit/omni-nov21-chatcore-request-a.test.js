// OmniRoute chat core request fixes, part A (#20372, #19890, #20547), offline fixtures only.
// #20372 is not applicable: DurinDoor has no plugin onRequest hook path (pinned below).
import "../translator/registerAll.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    parseRetryFromErrorMessage: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCapabilitiesForModel: vi.fn(() => ({})),
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  finishActiveSession: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

const ROOT = resolve(import.meta.dirname, "../..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("#20372 plugin onRequest once per client request", () => {
  it("is not applicable: no plugin onRequest hook path exists to memoize", () => {
    const files = [...walk(join(ROOT, "open-sse")), ...walk(join(ROOT, "src"))];
    const hits = files.filter((file) => /runPluginOnRequestHook|runPluginRequestGate|registerHook\(\s*["']onRequest/.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
    expect(statSync(join(ROOT, "src/lib")).isDirectory()).toBe(true);
    expect(() => statSync(join(ROOT, "src/lib/plugins"))).toThrow();
  });
});

describe("#19890 agy alias pre-response timeout", () => {
  const contents = { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } };

  function executorFor(provider) {
    const instance = new AntigravityExecutor(provider);
    instance.getFallbackCount = () => 2;
    instance.buildUrl = () => "https://example.test/v1";
    instance.buildHeaders = () => ({});
    instance.transformRequest = () => ({});
    return instance;
  }

  async function headerTimeout(provider) {
    const directFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return executorFor(provider).execute({
      model: "test",
      body: contents,
      credentials: {},
      requestPolicy: { headerTimeoutMs: 5, maxTransportAttempts: 3 },
      directFetch,
    }).catch((error) => error);
  }

  it("marks the header deadline for antigravity and for the agy alias", async () => {
    for (const provider of ["antigravity", "agy"]) {
      const error = await headerTimeout(provider);
      expect(error.errorKind).toBe("connect_timeout");
      expect(error.antigravityPreResponseTimeout).toBe(true);
    }
  });

  it("leaves a caller abort and an unmarked agy 504 response as ordinary outcomes", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller left", "AbortError");
    const abortFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort(reason);
    });
    const aborted = await executorFor("agy").execute({ model: "test", body: contents, credentials: {}, signal: controller.signal, directFetch: abortFetch }).catch((e) => e);
    expect(aborted).toBe(reason);
    expect(aborted.antigravityPreResponseTimeout).toBeUndefined();

    const response = new Response("upstream timeout", { status: 504 });
    const result = await executorFor("agy").execute({ model: "test", body: contents, credentials: {}, requestPolicy: { maxTransportAttempts: 3 }, directFetch: async () => response });
    expect(result.response).toBe(response);
    expect(result.response.status).toBe(504);
  });

  function options(provider, stream) {
    const body = { model: `${provider}/gemini-2.5-pro`, stream, messages: [{ role: "user", content: "hi" }] };
    return {
      body,
      modelInfo: { provider, model: "gemini-2.5-pro" },
      credentials: { accessToken: "tok", connectionId: `${provider}-conn`, providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
      connectionId: `${provider}-conn`,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
    };
  }

  function timeoutError(marked) {
    const error = new Error("response start timeout");
    error.name = "TimeoutError";
    error.errorKind = "connect_timeout";
    if (marked) error.antigravityPreResponseTimeout = true;
    return error;
  }

  beforeEach(() => {
    mocks.execute.mockReset();
  });

  for (const stream of [true, false]) {
    const path = stream ? "streaming" : "non-streaming";

    it(`chat core keeps a marked agy timeout as a 504 pre-response failure (${path})`, async () => {
      mocks.execute.mockRejectedValue(timeoutError(true));
      const result = await handleChatCore(options("agy", stream));
      expect(result.status).toBe(504);
      expect(result.antigravityPreResponseTimeout).toBe(true);
    });

    it(`chat core still handles a marked antigravity timeout the same way (${path})`, async () => {
      mocks.execute.mockRejectedValue(timeoutError(true));
      const result = await handleChatCore(options("antigravity", stream));
      expect(result.status).toBe(504);
      expect(result.antigravityPreResponseTimeout).toBe(true);
    });

    it(`chat core keeps an unmarked agy timeout and a non-Antigravity marker ordinary (${path})`, async () => {
      mocks.execute.mockRejectedValue(timeoutError(false));
      const unmarked = await handleChatCore(options("agy", stream));
      expect(unmarked.status).toBe(502);
      expect(unmarked.antigravityPreResponseTimeout).toBe(false);

      mocks.execute.mockRejectedValue(timeoutError(true));
      const other = await handleChatCore(options("openai", stream));
      expect(other.status).toBe(502);
      expect(other.antigravityPreResponseTimeout).toBe(false);
    });
  }
});

describe("#20547 required max_tokens for Claude targets", () => {
  const claudeBody = (extra) => ({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }], ...extra });

  function transform(provider, model, body, credentials = null) {
    return new DefaultExecutor(provider).transformRequest(model, body, false, credentials, {});
  }

  it("already covered: a Claude target keeps max_tokens without capability metadata", () => {
    const out = transform("anthropic", "claude-sonnet-4-5", claudeBody({ max_tokens: 64 }));
    expect(out.max_tokens).toBe(64);
    expect(out.max_completion_tokens).toBeUndefined();
    // A model id the OpenAI-style rename rules would otherwise rename.
    const odd = transform("anthropic", "o3-proxy", claudeBody({ model: "o3-proxy", max_tokens: 64 }));
    expect(odd.max_tokens).toBe(64);
    expect(odd.max_completion_tokens).toBeUndefined();
  });

  it("already covered: a Claude target maps max_completion_tokens back to max_tokens", () => {
    const out = transform("anthropic", "o3-proxy", claudeBody({ model: "o3-proxy", max_completion_tokens: 64 }));
    expect(out.max_tokens).toBe(64);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("already covered: an explicit max_tokens wins when both fields are supplied", () => {
    const out = transform("anthropic", "claude-sonnet-4-5", claudeBody({ max_tokens: 32, max_completion_tokens: 64 }));
    expect(out.max_tokens).toBe(32);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("control: a non-Claude target still renames max_tokens for reasoning families", () => {
    const out = transform("openai", "o3", { model: "o3", messages: [], max_tokens: 64 });
    expect(out.max_completion_tokens).toBe(64);
    expect(out.max_tokens).toBeUndefined();
  });
});
