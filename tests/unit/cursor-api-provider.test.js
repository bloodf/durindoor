// Staged Cursor API-key connection. Every network edge is a closed mock: the
// key exchange is an injected fetch, the Cursor AgentService stream is an
// in-memory fake, and the live model catalog is a stub. No Cursor account,
// `crsr_` key, session token, plan or network is involved; all keys and tokens
// below are synthetic placeholders.
//
// Port source: OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/cursor/index.ts and
// open-sse/services/cursorApiKeyAuth.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/services/cursorModels.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveCursorModels: vi.fn(),
}));

// The staging rule: the entry and executor are composed here, never registered.
const clock = vi.hoisted(() => ({ now: 1_800_000_000_000 }));
const exchangeFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { default: entry } = await import("../../open-sse/providers/private/cursor-api.js");
  return { ...original, default: [...original.default.filter((row) => row.id !== entry.id), entry] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const original = await importOriginal();
  const { CursorApiExecutor } = await import("../../open-sse/executors/cursor-api.js");
  const executor = new CursorApiExecutor({ fetchImpl: exchangeFetch, now: () => clock.now });
  const isCursorApi = (provider) => provider === "cursor-api" || provider === "cua";
  return {
    ...original,
    getExecutor: (provider) => (isCursorApi(provider) ? executor : original.getExecutor(provider)),
    hasSpecializedExecutor: (provider) => isCursorApi(provider) || original.hasSpecializedExecutor(provider),
  };
});

import entry, { cursorApiCookieProfile } from "../../open-sse/providers/private/cursor-api.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { CursorApiExecutor, discoverCursorApiModels, deriveCursorApiMachineId } from "../../open-sse/executors/cursor-api.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveCursorModels } from "../../open-sse/services/cursorModels.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const KEY_A = "crsr_synthetic_alpha";
const KEY_B = "crsr_synthetic_beta";
const EXCHANGE_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";
const MODEL = "gpt-5.2";
const LEN = 2;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── fakes ────────────────────────────────────────────────────────────────────
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sessionJwt = (label, expiresInSec = 3600) =>
  `${b64({ alg: "none" })}.${b64({ sub: label, exp: Math.floor(clock.now / 1000) + expiresInSec })}.sig`;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Exchange fake: one distinct session token per key, counted per call. */
function exchangeByKey(expiresInSec = 3600) {
  const counts = new Map();
  exchangeFetch.mockImplementation(async (url, init) => {
    const key = String(init.headers.authorization).replace(/^Bearer /, "");
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    return json({ accessToken: sessionJwt(`${key}#${n}`, expiresInSec), refreshToken: sessionJwt(`refresh-${key}#${n}`, expiresInSec) });
  });
  return counts;
}

// agent.v1.AgentServerMessage.interaction_update (field 1) -> text delta / turn ended.
const textFrame = (text) => Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN,
  Buffer.from(encodeField(1, LEN, Buffer.from(encodeField(1, LEN, text)))))));
const turnEndedFrame = () => Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN,
  Buffer.from(encodeField(14, LEN, new Uint8Array())))));

/** Replaces the h2 AgentService transport on the registered executor. */
function fakeAgent({ status = 200, frames = [textFrame("hello"), turnEndedFrame()] } = {}) {
  const opened = [];
  getExecutor("cursor-api").openAgentHttp2Stream = (url, headers) => {
    opened.push({ url, headers });
    const queue = [...frames];
    return {
      responseHeaders: Promise.resolve({ ":status": status }),
      write() {}, end() {}, close() {},
      async read() { return queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true }; },
    };
  };
  return opened;
}

const connection = (apiKey, id, providerSpecificData = { enableSessionDispatch: true }) => ({ apiKey, id, providerSpecificData });

function chat(endpoint, { apiKey = KEY_A, id = "cua-a", stream = false, providerSpecificData, extra = {} } = {}) {
  const claude = endpoint === "/v1/messages";
  // The shared Cursor translator refuses explicit output-token caps, so the
  // happy-path bodies carry none (see the max_tokens test below).
  const body = { model: MODEL, stream, messages: [{ role: "user", content: "hi" }], ...extra };
  return handleChatCore({
    body, modelInfo: { provider: "cursor-api", model: MODEL },
    credentials: connection(apiKey, id, providerSpecificData),
    clientRawRequest: { endpoint, body, headers: {} },
    sourceFormatOverride: claude ? FORMATS.CLAUDE : FORMATS.OPENAI,
    connectionId: id, log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
}

const sseData = (text) => text.split("\n\n").filter((part) => part.includes("data: ")).map((part) => part.slice(part.indexOf("data: ") + 6)).filter((data) => data !== "[DONE]").map((data) => JSON.parse(data));
const subjectOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
const bearerOf = (headers) => String(headers.authorization).replace(/^Bearer /, "");

describe("staged Cursor API provider", () => {
  beforeEach(() => {
    clock.now = 1_800_000_000_000;
    const executor = getExecutor("cursor-api");
    executor.sessions.clear();
    executor.inflight.clear();
  });
  afterEach(() => { vi.clearAllMocks(); exchangeFetch.mockReset(); });

  describe("composition", () => {
    it("is a separate API-key identity that shares the Cursor request path", () => {
      expect(REGISTRY.find((row) => row.id === "cursor-api")).toBe(entry);
      expect(REGISTRY.find((row) => row.id === "cursor")).toBeDefined();
      expect(entry).toMatchObject({ alias: "cua", category: "apikey", authType: "apikey" });
      expect(PROVIDERS["cursor-api"]).toMatchObject({
        baseUrl: PROVIDERS.cursor.baseUrl, chatPath: PROVIDERS.cursor.chatPath, format: "cursor",
      });
      expect(entry.models).toEqual(REGISTRY.find((row) => row.id === "cursor").models);
      expect(getExecutor("cua")).toBeInstanceOf(CursorApiExecutor);
      expect(getExecutor("cursor-api")).toBe(getExecutor("cua"));
      expect(getExecutor("cursor")).not.toBeInstanceOf(CursorApiExecutor);
    });

    it("declares that cookie capture does not apply to a key connection", () => {
      expect(cursorApiCookieProfile).toEqual({ notApplicable: true, domains: [], cookieNames: [], validationProbe: null });
    });
  });

  describe("sign-in and refresh", () => {
    it("exchanges the key once, reuses the session token and sends it as the chat bearer", async () => {
      const counts = exchangeByKey();
      const opened = fakeAgent();
      for (let i = 0; i < 2; i += 1) expect((await chat("/v1/chat/completions")).success).toBe(true);

      expect(exchangeFetch).toHaveBeenCalledTimes(1);
      const [url, init] = exchangeFetch.mock.calls[0];
      expect(url).toBe(EXCHANGE_URL);
      expect(init).toMatchObject({ method: "POST", body: "{}" });
      expect(init.headers.authorization).toBe(`Bearer ${KEY_A}`);
      expect(counts.get(KEY_A)).toBe(1);

      expect(opened).toHaveLength(2);
      for (const { headers } of opened) {
        // The raw crsr_ key must never be the upstream bearer.
        expect(bearerOf(headers)).toBe(sessionJwt(`${KEY_A}#1`));
        expect(JSON.stringify(headers)).not.toContain(KEY_A);
        expect(headers["x-cursor-checksum"]).toContain(deriveCursorApiMachineId(KEY_A));
      }
    });

    it("re-exchanges before the session token expires and on a forced refresh", async () => {
      const counts = exchangeByKey(3600);
      const opened = fakeAgent();
      await chat("/v1/chat/completions");

      clock.now += 54 * 60 * 1000; // still outside the five-minute skew: cached
      await chat("/v1/chat/completions");
      expect(counts.get(KEY_A)).toBe(1);

      clock.now += 2 * 60 * 1000; // 56 minutes in: inside the skew of the one-hour token
      await chat("/v1/chat/completions");
      expect(counts.get(KEY_A)).toBe(2);
      expect(subjectOf(bearerOf(opened[0].headers))).toBe(`${KEY_A}#1`);
      expect(subjectOf(bearerOf(opened[2].headers))).toBe(`${KEY_A}#2`);

      const refreshed = await getExecutor("cursor-api").refreshCredentials(connection(KEY_A, "cua-a"), log);
      expect(counts.get(KEY_A)).toBe(3);
      expect(refreshed.accessToken).toContain(".");
      expect(refreshed.refreshToken).toContain(".");
      expect(refreshed.expiresIn).toBeGreaterThan(0);
    });

    it("does not refresh a connection that has no Cursor API key or has not opted in", async () => {
      expect(await getExecutor("cursor-api").refreshCredentials(connection("not-a-cursor-key", "x"), log)).toBeNull();
      expect(await getExecutor("cursor-api").refreshCredentials(connection(KEY_A, "x", {}), log)).toBeNull();
      expect(exchangeFetch).not.toHaveBeenCalled();
    });

    it("rejects a malformed key before any network call", async () => {
      const result = await chat("/v1/chat/completions", { apiKey: "sk-not-a-cursor-key" });
      expect(result.status).toBe(400);
      expect(exchangeFetch).not.toHaveBeenCalled();
    });
  });

  describe("model discovery", () => {
    it("exchanges the key and reads the live catalog with the session token", async () => {
      exchangeByKey();
      resolveCursorModels.mockResolvedValueOnce({ models: [{ id: "composer-2.5", name: "Composer 2.5", supportsAgent: true }] });
      const found = await discoverCursorApiModels(connection(KEY_A, "cua-a"), { executor: getExecutor("cursor-api"), log });
      expect(found.models).toEqual([{ id: "composer-2.5", name: "Composer 2.5" }]);
      const [credentials, options] = resolveCursorModels.mock.calls[0];
      expect(credentials.accessToken).toBe(sessionJwt(`${KEY_A}#1`));
      expect(credentials.providerSpecificData.machineId).toBe(deriveCursorApiMachineId(KEY_A));
      expect(options.forceRefresh).toBe(true);
    });

    it("falls back to the static catalog with a warning when the live list is empty", async () => {
      exchangeByKey();
      resolveCursorModels.mockResolvedValueOnce({ models: [] });
      const found = await discoverCursorApiModels(connection(KEY_A, "cua-a"), { executor: getExecutor("cursor-api"), log, staticModels: entry.models });
      expect(found.models).toBe(entry.models);
      expect(found.warning).toMatch(/static catalog/);
    });

    it("surfaces a rejected key during discovery", async () => {
      exchangeFetch.mockResolvedValueOnce(json({}, 401));
      await expect(discoverCursorApiModels(connection(KEY_A, "cua-a"), { executor: getExecutor("cursor-api"), log }))
        .rejects.toMatchObject({ status: 401, code: "cursor_api_key_rejected" });
    });
  });

  describe("opt-in guard", () => {
    it.each([
      ["missing", {}],
      ["false", { enableSessionDispatch: false }],
      ["the string \"true\"", { enableSessionDispatch: "true" }],
    ])("fails with a clear error and touches nothing when the flag is %s", async (_label, providerSpecificData) => {
      const opened = fakeAgent();
      const result = await chat("/v1/chat/completions", { providerSpecificData });
      expect(result.success).toBe(false);
      expect(result.status).toBe(403);
      const body = await result.response.json();
      // chatCore normalizes the wire code; the message keeps the actionable text.
      expect(body.error.type).toBe("permission_error");
      expect(body.error.message).toContain("providerSpecificData.enableSessionDispatch");
      const direct = await getExecutor("cursor-api").execute({ model: MODEL, body: { messages: [] }, stream: false, credentials: connection(KEY_A, "cua-a", providerSpecificData) });
      expect(direct.response.status).toBe(403);
      expect((await direct.response.json()).error).toMatchObject({ type: "permission_error", code: "cursor_api_dispatch_disabled" });
      expect(exchangeFetch).not.toHaveBeenCalled();
      expect(opened).toHaveLength(0);
    });
  });

  describe("chat", () => {
    it.each(["/v1/chat/completions", "/v1/messages"])("serves JSON chat through %s", async (endpoint) => {
      exchangeByKey();
      fakeAgent({ frames: [textFrame("hel"), textFrame("lo"), turnEndedFrame()] });
      const result = await chat(endpoint);
      expect(result.success).toBe(true);
      const payload = await result.response.json();
      if (endpoint === "/v1/messages") {
        expect(payload.type).toBe("message");
        expect(payload.content[0]).toMatchObject({ type: "text", text: "hello" });
      } else {
        expect(payload.choices[0].message.content).toBe("hello");
        expect(payload.choices[0].finish_reason).toBe("stop");
      }
    });

    it.each(["/v1/chat/completions", "/v1/messages"])("streams chat through %s", async (endpoint) => {
      exchangeByKey();
      fakeAgent({ frames: [textFrame("hel"), textFrame("lo"), turnEndedFrame()] });
      const result = await chat(endpoint, { stream: true });
      expect(result.success).toBe(true);
      const text = await result.response.text();
      if (endpoint === "/v1/messages") {
        expect(text).toContain("event: message_start");
        expect(text).toContain("event: message_stop");
        const deltas = sseData(text).filter((event) => event.type === "content_block_delta");
        expect(deltas.map((event) => event.delta.text).join("")).toBe("hello");
      } else {
        const events = sseData(text);
        expect(events.map((event) => event.choices?.[0]?.delta?.content || "").join("")).toBe("hello");
        expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(true);
        expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
      }
    });
  });

  describe("shared Cursor request path", () => {
    it("keeps the existing refusal of explicit output-token caps", async () => {
      exchangeByKey();
      const opened = fakeAgent();
      const result = await chat("/v1/messages", { extra: { max_tokens: 32 } });
      expect(result.status).toBe(400);
      expect((await result.response.json()).error.message).toMatch(/does not support max_tokens/);
      expect(opened).toHaveLength(0);
    });
  });

  describe("credential and quota mapping", () => {
    it.each(["/v1/chat/completions", "/v1/messages"])("maps a rejected key at the exchange to 401 through %s without leaking it", async (endpoint) => {
      exchangeFetch.mockResolvedValue(json({ error: "bad key" }, 401));
      const opened = fakeAgent();
      const result = await chat(endpoint);
      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
      const body = await result.response.json();
      expect(body.error.type).toBe("authentication_error");
      expect(body.error.message).toContain("Cursor rejected the API key");
      expect(JSON.stringify(body)).not.toContain(KEY_A);
      expect(opened).toHaveLength(0);
    });

    it("maps a 403 from the exchange to the same credential error", async () => {
      exchangeFetch.mockResolvedValue(json({}, 403));
      expect((await chat("/v1/chat/completions")).status).toBe(401);
    });

    it("maps a quota response at the exchange to 429 and keeps Retry-After", async () => {
      exchangeFetch.mockResolvedValue(json({}, 429, { "retry-after": "30" }));
      const result = await chat("/v1/chat/completions");
      expect(result.status).toBe(429);
      expect((await result.response.json()).error.type).toBe("rate_limit_error");
      const direct = await getExecutor("cursor-api").execute({ model: MODEL, body: { messages: [{ role: "user", content: "hi" }] }, stream: false, credentials: connection(KEY_A, "cua-a") });
      expect(direct.response.status).toBe(429);
      expect((await direct.response.json()).error).toMatchObject({ type: "rate_limit_error", code: "cursor_api_rate_limited" });
    });

    it("reports an unreachable or malformed exchange as a gateway error", async () => {
      exchangeFetch.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${KEY_A}`));
      const unreachable = await chat("/v1/chat/completions");
      expect(unreachable.status).toBe(502);
      expect(JSON.stringify(await unreachable.response.json())).not.toContain(KEY_A);

      exchangeFetch.mockResolvedValueOnce(new Response("<html>nope</html>", { status: 200 }));
      expect((await chat("/v1/chat/completions")).status).toBe(502);

      exchangeFetch.mockResolvedValueOnce(json({ refreshToken: "x" }));
      expect((await chat("/v1/chat/completions")).status).toBe(502);
    });

    it("maps an upstream 401 to authentication_error, drops the cached session and re-exchanges", async () => {
      const counts = exchangeByKey();
      fakeAgent({ status: 401 });
      const result = await chat("/v1/chat/completions");
      expect(result.status).toBe(401);
      expect((await result.response.json()).error.type).toBe("authentication_error");
      // First exchange, then the refresh-and-retry after the 401 forced a new one.
      expect(counts.get(KEY_A)).toBeGreaterThanOrEqual(2);
    });

    it("maps an upstream 429 to rate_limit_error and keeps the cached session", async () => {
      const counts = exchangeByKey();
      fakeAgent({ status: 429 });
      const result = await chat("/v1/chat/completions");
      expect(result.status).toBe(429);
      expect((await result.response.json()).error.type).toBe("rate_limit_error");
      expect(counts.get(KEY_A)).toBe(1);
    });
  });

  describe("connection isolation", () => {
    it("keeps session tokens, machine ids and invalidation separate per key", async () => {
      const counts = exchangeByKey();
      const opened = fakeAgent();
      await chat("/v1/chat/completions", { apiKey: KEY_A, id: "cua-a" });
      await chat("/v1/chat/completions", { apiKey: KEY_B, id: "cua-b" });

      expect(counts.get(KEY_A)).toBe(1);
      expect(counts.get(KEY_B)).toBe(1);
      expect(bearerOf(opened[0].headers)).toBe(sessionJwt(`${KEY_A}#1`));
      expect(bearerOf(opened[1].headers)).toBe(sessionJwt(`${KEY_B}#1`));
      expect(opened[0].headers["x-cursor-checksum"]).toContain(deriveCursorApiMachineId(KEY_A));
      expect(opened[1].headers["x-cursor-checksum"]).toContain(deriveCursorApiMachineId(KEY_B));
      expect(deriveCursorApiMachineId(KEY_A)).not.toBe(deriveCursorApiMachineId(KEY_B));

      // Invalidating one key's session leaves the other connection's cached token alone.
      getExecutor("cursor-api").invalidateSession(KEY_A);
      await chat("/v1/chat/completions", { apiKey: KEY_B, id: "cua-b" });
      await chat("/v1/chat/completions", { apiKey: KEY_A, id: "cua-a" });
      expect(counts.get(KEY_B)).toBe(1);
      expect(counts.get(KEY_A)).toBe(2);
    });

    it("lets one connection opt in without enabling another", async () => {
      exchangeByKey();
      fakeAgent();
      const enabled = await chat("/v1/chat/completions", { apiKey: KEY_A, id: "cua-a" });
      const disabled = await chat("/v1/chat/completions", { apiKey: KEY_B, id: "cua-b", providerSpecificData: {} });
      expect(enabled.success).toBe(true);
      expect(disabled.status).toBe(403);
      expect(exchangeFetch.mock.calls.every(([, init]) => init.headers.authorization === `Bearer ${KEY_A}`)).toBe(true);
    });

    it("shares one in-flight exchange for concurrent requests on the same key only", async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      exchangeFetch.mockImplementation(async (url, init) => {
        await gate;
        return json({ accessToken: sessionJwt(String(init.headers.authorization)) });
      });
      const executor = getExecutor("cursor-api");
      const pending = [executor.resolveSession(KEY_A), executor.resolveSession(KEY_A), executor.resolveSession(KEY_B)];
      release();
      const [a1, a2, b1] = await Promise.all(pending);
      expect(a1).toBe(a2);
      expect(a1.accessToken).not.toBe(b1.accessToken);
      expect(exchangeFetch).toHaveBeenCalledTimes(2);
    });
  });
});
