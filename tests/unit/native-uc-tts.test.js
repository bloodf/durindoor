// UC (uncensored.com) native text-to-speech adapter, staged and unregistered
// (#2034). Closed mocks only: the Clerk mint is a mocked fetch, the speech
// socket is a synthetic WebSocket class, every credential is synthetic, and an
// unexpected request or socket fails the test. Wire shapes follow OmniRoute
// c71f0065 (handlers/uc/ucTts.ts, handlers/audioSpeech.ts `uc-tts` branch,
// executors/uc/clerkAuth.ts, executors/uc/credentials.ts, config/audioRegistry.ts).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-uc-tts/index.js";
import {
  UC_PROVIDER_DEFINITION,
  UC_TTS_REGISTRY_ENTRY,
  createUcTtsAdapter,
  ucTtsAdapter,
} from "../../open-sse/services/providerParity/native-uc-tts/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-uc-tts/registration.json", import.meta.url), "utf8"));

const CLERK = "https://clerk.uncensored.com";
const WS_HOST = "wss://tts-stream.chatuncensored.ai";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwtFor = (uid, tag) => `${b64url({ alg: "RS256" })}.${b64url({ uid, sid: tag, exp: 9_999_999_999 })}.SYNTHETICsig${tag}`;

const ACCOUNT_A = {
  uid: "0a1b2c3d-0000-4000-8000-00000000000a",
  sid: "sess_SYNTHETICaaaa",
  client: "SYNTHETIC-client-cookie-aaaa",
  cf: "SYNTHETIC-cfbm-aaaa",
};
const ACCOUNT_B = {
  uid: "0a1b2c3d-0000-4000-8000-00000000000b",
  sid: "sess_SYNTHETICbbbb",
  client: "SYNTHETIC-client-cookie-bbbb",
  cf: "SYNTHETIC-cfbm-bbbb",
};
const JWT_A = jwtFor(ACCOUNT_A.uid, "a");
const JWT_B = jwtFor(ACCOUNT_B.uid, "b");
const credsFor = (account, extra = {}) => ({
  providerSpecificData: {
    ucClientCookie: account.client,
    ucSid: account.sid,
    ucUid: account.uid,
    ucCookies: { __cf_bm: { value: account.cf } },
    ...extra,
  },
});
const CREDS_A = credsFor(ACCOUNT_A);
const CREDS_B = credsFor(ACCOUNT_B);

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(300, 9)]);
const PART_1 = MP3.subarray(0, 150);
const PART_2 = MP3.subarray(150);
const dataFrame = (bytes) => JSON.stringify({ data: Buffer.from(bytes).toString("base64") });
const usageFrame = (usage_percent, threshold_crossed = false) => JSON.stringify({ type: "usage_update", usage_percent, threshold_crossed });

const json = (value, status = 200, init = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...init.headers } });
const minted = (jwt = JWT_A) => json({ object: "token", jwt });
const withUrl = (response, url) => Object.defineProperty(response, "url", { value: url });

const originalFetch = global.fetch;
let fetchCalls;
let sockets;
let scripts;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}

class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.sent = [];
    this.listeners = {};
    this.closed = false;
    this.terminated = false;
    sockets.push(this);
    const script = scripts.shift();
    this.unexpected = !script;
    queueMicrotask(() => script?.(this));
  }
  on(event, handler) {
    this.listeners[event] = handler;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  terminate() {
    this.terminated = true;
  }
  open() {
    this.onopen?.();
  }
  message(data) {
    this.onmessage?.({ data });
  }
  end(code = 1000) {
    this.onclose?.({ code });
  }
}

/** Socket scripts. */
const answers = (...frames) => (socket) => {
  socket.open();
  for (const frame of frames) socket.message(frame);
  socket.end(1000);
};
const happy = () => answers(usageFrame(12.5), dataFrame(PART_1), dataFrame(PART_2));

const speak = ({ text = "hello there", model = "jade", credentials = CREDS_A, options = {}, adapter = {} } = {}) =>
  createUcTtsAdapter({ WebSocketImpl: FakeSocket, ...adapter }).synthesize(text, model, credentials, "mp3", options);

const errorText = async (result) => (await result.response.clone().json()).error.message;
async function assertNoLeak(result) {
  const text = `${result.error ?? ""} ${await result.response.clone().text()}`;
  for (const secret of [ACCOUNT_A.client, ACCOUNT_A.cf, ACCOUNT_B.client, ACCOUNT_B.cf, JWT_A, JWT_B, "upstream echo", "/srv/app"]) {
    expect(text).not.toContain(secret);
  }
}
const leakyBody = (status) => json({ errors: [{ message: `upstream echo ${ACCOUNT_A.client} ${JWT_A} at /srv/app/x.js:1` }] }, status);

beforeEach(() => {
  fetchCalls = [];
  sockets = [];
  scripts = [];
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  expect(sockets.filter((socket) => socket.unexpected)).toEqual([]);
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the unrelated uc-direct entry unchanged", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(PROVIDERS.uc).toBeUndefined();
    expect(PROVIDERS.ucn).toBeUndefined();
    expect(PROVIDER_MEDIA.uc).toBeUndefined();
    expect(getTtsAdapter("uc")).toBeNull();
    expect(getTtsAdapter("ucn")).toBeNull();
    expect(PROVIDERS["uc-direct"]).toBeDefined();
    expect(PROVIDERS["uc-direct"].transport?.baseUrl ?? PROVIDERS["uc-direct"].baseUrl).toBe("https://api.uncensored.com/api/v1/chat/completions");
  });
});

describe("staged module metadata", () => {
  it("exports the exact pinned source registry fields", () => {
    expect(UC_TTS_REGISTRY_ENTRY).toEqual({
      id: "uc",
      baseUrl: "wss://tts-stream.chatuncensored.ai",
      authType: "web-cookie",
      authHeader: "none",
      format: "uc-tts",
      models: [{ id: "jade", name: "UC Voice (Jade)" }],
    });
    expect(REGISTRATION.source.registryFields).toEqual({
      id: "uc", baseUrl: "wss://tts-stream.chatuncensored.ai", authType: "web-cookie", authHeader: "none", format: "uc-tts",
    });
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
  });

  it("describes the provider identity, kinds and credential fields consistently", () => {
    expect(UC_PROVIDER_DEFINITION.id).toBe("uc");
    expect(UC_PROVIDER_DEFINITION.alias).toBe("ucn");
    expect(UC_PROVIDER_DEFINITION.serviceKinds).toEqual(["tts"]);
    expect(UC_PROVIDER_DEFINITION.ttsConfig).toMatchObject({ baseUrl: WS_HOST, authType: "web-cookie", authHeader: "none", format: "uc-tts" });
    expect(REGISTRATION.provider.canonicalId).toBe(UC_PROVIDER_DEFINITION.id);
    expect(REGISTRATION.provider.aliases).toEqual([UC_PROVIDER_DEFINITION.alias]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual([...UC_PROVIDER_DEFINITION.serviceKinds]);
    expect(REGISTRATION.provider.auth.credentialFields).toEqual(JSON.parse(JSON.stringify(UC_PROVIDER_DEFINITION.credentialFields)));
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(staged.UC_TTS_MODELS.map((m) => m.id));
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(ucTtsAdapter.provider).toBe("uc");
    expect(ucTtsAdapter.responseFormats).toEqual(["mp3"]);
  });
});

describe("wire contract", () => {
  it("mints with the source Clerk request and opens the source socket with Origin only", async () => {
    serve(minted());
    scripts.push(happy());
    const result = await speak({ text: "Read this aloud", options: { voice: "nova" } });
    expect(result.format).toBe("mp3");

    expect(fetchCalls).toHaveLength(1);
    const [mint] = fetchCalls;
    expect(mint.url).toBe(`${CLERK}/v1/client/sessions/${ACCOUNT_A.sid}/tokens?_clerk_js_version=5.127.1`);
    expect(mint.init.method).toBe("POST");
    expect(mint.init.body).toBe("");
    expect(mint.init.redirect).toBe("manual");
    expect(mint.init.headers).toEqual({
      Origin: "https://uncensored.com",
      Referer: "https://uncensored.com/",
      Cookie: `__cf_bm=${ACCOUNT_A.cf}; __client=${ACCOUNT_A.client}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });

    expect(sockets).toHaveLength(1);
    const [socket] = sockets;
    expect(socket.url).toBe(`${WS_HOST}/${ACCOUNT_A.uid}?token=${encodeURIComponent(JWT_A)}`);
    expect(socket.options.headers).toEqual({ Origin: "https://uncensored.com" });
    expect(socket.options.followRedirects).toBe(false);
    expect(socket.options.agent).toBeUndefined();

    expect(socket.sent).toHaveLength(1);
    const frame = socket.sent[0];
    expect(Object.keys(frame).sort()).toEqual(
      ["message_id", "message_type", "model", "raw_text", "text", "threadId", "thread_id", "token", "turn_anchor_message_id", "voice"]);
    expect(frame).toMatchObject({ message_type: "start", text: "Read this aloud", raw_text: "Read this aloud", model: "jade", voice: "nova", token: JWT_A });
    expect(frame.thread_id).toBe(frame.threadId);
    for (const id of [frame.thread_id, frame.message_id, frame.turn_anchor_message_id]) expect(id).toMatch(UUID);
    expect(new Set([frame.thread_id, frame.message_id, frame.turn_anchor_message_id]).size).toBe(3);
  });

  it("defaults the voice to jade and accepts the uc/ prefixed model id", async () => {
    serve(minted());
    scripts.push(happy());
    await speak({ model: "uc/jade", options: { voice: "  " } });
    expect(sockets[0].sent[0]).toMatchObject({ voice: "jade", model: "jade" });
  });

  it("accepts the source credential aliases and a flat cookie jar", async () => {
    serve(minted());
    scripts.push(happy());
    const credentials = { providerSpecificData: { __client: `"${ACCOUNT_A.client}"`, sid: ACCOUNT_A.sid, uid: ACCOUNT_A.uid, cookies: { __cf_bm: ACCOUNT_A.cf, "bad name": "x", evil: "a;b" } } };
    expect((await speak({ credentials })).format).toBe("mp3");
    expect(fetchCalls[0].init.headers.Cookie).toBe(`__cf_bm=${ACCOUNT_A.cf}; __client=${ACCOUNT_A.client}`);
  });
});

describe("success normalization and usage", () => {
  it("concatenates base64 chunks across messages, newline-delimited frames and binary frames", async () => {
    serve(minted());
    scripts.push((socket) => {
      socket.open();
      socket.message("not json at all");
      socket.message(`${usageFrame(40)}\n${dataFrame(MP3.subarray(0, 100))}\n`);
      socket.message(Buffer.from(dataFrame(MP3.subarray(100, 200))));
      socket.message(JSON.stringify({ type: "something_else" }));
      socket.message(dataFrame(MP3.subarray(200)));
      socket.message(usageFrame(41, true));
      socket.end(1005);
    });
    const result = await speak();
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.format).toBe("mp3");
    expect(result.acceptedJob).toBeUndefined();
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable",
      meta: { nativeUnitsSource: "input-characters", providerQuota: { usagePercent: 41, thresholdCrossed: true } },
    });
    expect(sockets[0].closed).toBe(true);
  });

  it("omits quota metadata when no usage frame arrived", async () => {
    serve(minted());
    scripts.push(answers(dataFrame(MP3)));
    const result = await speak();
    expect(result.accounting.meta).toEqual({ nativeUnitsSource: "input-characters" });
  });
});

describe("unsupported inputs are refused before any network call", () => {
  it.each([
    ["an unknown model", { model: "other" }, /Unsupported UC speech model/],
    ["empty text", { text: "   " }, /needs input text/],
    ["oversize text", { text: "x".repeat(4097) }, /limited to 4096/],
    ["a wav container", { options: { response_format: "wav" } }, /mp3 audio only/],
    ["a routed opus container", { options: { requestedResponseFormat: "opus" } }, /mp3 audio only/],
    ["streaming", { options: { stream: true } }, /streaming/],
    ["sse stream format", { options: { stream_format: "sse" } }, /streaming/],
    ["speed", { options: { speed: 1.5 } }, /speed/],
    ["instructions", { options: { instructions: "whisper" } }, /instructions/],
    ["a non-string voice", { options: { voice: 7 } }, /voice must be a string/],
    ["an unsafe voice", { options: { voice: "jade/../x" } }, /voice must be/],
  ])("%s", async (_label, call, message) => {
    const result = await speak(call);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorText(result)).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchCalls).toEqual([]);
    expect(sockets).toEqual([]);
  });

  it("accepts mp3, speed 1 and an empty instruction", async () => {
    serve(minted());
    scripts.push(happy());
    const result = await speak({ options: { response_format: "mp3", speed: 1, instructions: "" } });
    expect(result.format).toBe("mp3");
  });

  it.each([
    ["no providerSpecificData", { apiKey: "sk-SYNTHETIC-not-used" }],
    ["a missing uid", { providerSpecificData: { ucClientCookie: ACCOUNT_A.client, ucSid: ACCOUNT_A.sid } }],
    ["a header-splitting cookie", credsFor(ACCOUNT_A, { ucClientCookie: "abc\r\nX-Evil: 1" })],
    ["a path-injecting sid", credsFor(ACCOUNT_A, { ucSid: "sess_a/../../admin" })],
    ["a path-injecting uid", credsFor(ACCOUNT_A, { ucUid: "../admin?x=1" })],
  ])("refuses %s with 401 and no network", async (_label, credentials) => {
    const result = await speak({ credentials });
    expect(result.status).toBe(401);
    expect(await errorText(result)).toMatch(/credential not configured/);
    expect(fetchCalls).toEqual([]);
    expect(sockets).toEqual([]);
  });
});

describe("mint failures (nothing billable was sent)", () => {
  it.each([
    [401, 401, /sign in again/],
    [403, 401, /sign in again/],
    [500, 502, /failed with 500/],
    [404, 502, /failed with 404/],
  ])("maps a %i mint answer to %i without quoting the body", async (upstream, status, message) => {
    serve(leakyBody(upstream));
    const result = await speak();
    expect(result.status).toBe(status);
    expect(await errorText(result)).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(sockets).toEqual([]);
    await assertNoLeak(result);
  });

  it("keeps a bounded Retry-After on a 429 mint", async () => {
    serve(json({ errors: [] }, 429, { headers: { "retry-after": "30" } }));
    const before = Date.now();
    const result = await speak();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 29_000);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses a redirect instead of following it with the cookie", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/redirected; refused/);
    expect(fetchCalls).toHaveLength(1);
    expect(sockets).toEqual([]);
  });

  it("refuses an answer from another origin", async () => {
    serve(withUrl(minted(), "https://evil.example/v1/client/sessions/x/tokens"));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/unexpected origin/);
    expect(sockets).toEqual([]);
  });

  it.each([
    ["non-JSON", new Response("<html>upstream echo</html>", { status: 200 })],
    ["no jwt", json({ object: "token" })],
    ["a non-JWT token", json({ jwt: "not a jwt; Cookie: x" })],
  ])("refuses a %s mint answer", async (_label, response) => {
    serve(response);
    const result = await speak();
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/unreadable/);
    expect(sockets).toEqual([]);
    await assertNoLeak(result);
  });

  it("accepts the source `token` fallback field", async () => {
    serve(json({ token: JWT_A }));
    scripts.push(happy());
    expect((await speak()).format).toBe("mp3");
    expect(sockets[0].sent[0].token).toBe(JWT_A);
  });

  it("refuses a token minted for another account than the selected connection", async () => {
    serve(minted(JWT_B));
    const result = await speak();
    expect(result.status).toBe(401);
    expect(await errorText(result)).toMatch(/different account/);
    expect(sockets).toEqual([]);
    await assertNoLeak(result);
  });

  it("maps a transport failure to 502 without a socket", async () => {
    serve(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error(`connect ${ACCOUNT_A.client}`) });
    });
    const result = await speak();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("bounds the mint with its own deadline", async () => {
    serve((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    const result = await speak({ adapter: { mintTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(sockets).toEqual([]);
  });
});

describe("two credentials", () => {
  it("keeps each call on its own connection identity with no shared token", async () => {
    serve(minted(JWT_A), minted(JWT_B), minted(JWT_A));
    scripts.push(happy(), happy(), happy());
    const adapter = createUcTtsAdapter({ WebSocketImpl: FakeSocket });
    await adapter.synthesize("one", "jade", CREDS_A, "mp3", {});
    await adapter.synthesize("two", "jade", CREDS_B, "mp3", {});
    await adapter.synthesize("three", "jade", CREDS_A, "mp3", {});

    expect(fetchCalls.map((c) => c.url)).toEqual([
      `${CLERK}/v1/client/sessions/${ACCOUNT_A.sid}/tokens?_clerk_js_version=5.127.1`,
      `${CLERK}/v1/client/sessions/${ACCOUNT_B.sid}/tokens?_clerk_js_version=5.127.1`,
      `${CLERK}/v1/client/sessions/${ACCOUNT_A.sid}/tokens?_clerk_js_version=5.127.1`,
    ]);
    expect(fetchCalls[1].init.headers.Cookie).toBe(`__cf_bm=${ACCOUNT_B.cf}; __client=${ACCOUNT_B.client}`);
    expect(fetchCalls[1].init.headers.Cookie).not.toContain(ACCOUNT_A.client);
    expect(sockets.map((s) => s.url)).toEqual([
      `${WS_HOST}/${ACCOUNT_A.uid}?token=${encodeURIComponent(JWT_A)}`,
      `${WS_HOST}/${ACCOUNT_B.uid}?token=${encodeURIComponent(JWT_B)}`,
      `${WS_HOST}/${ACCOUNT_A.uid}?token=${encodeURIComponent(JWT_A)}`,
    ]);
    expect(sockets.map((s) => s.sent[0].token)).toEqual([JWT_A, JWT_B, JWT_A]);
    for (const socket of sockets) expect(JSON.stringify(socket.options)).not.toContain("SYNTHETIC-client-cookie");
  });

  it("scopes a refused credential to its own connection", async () => {
    serve(leakyBody(401), minted(JWT_B));
    scripts.push(happy());
    const adapter = createUcTtsAdapter({ WebSocketImpl: FakeSocket });
    const refused = await adapter.synthesize("one", "jade", CREDS_A, "mp3", {});
    const ok = await adapter.synthesize("two", "jade", CREDS_B, "mp3", {});
    expect(refused.status).toBe(401);
    expect(ok.format).toBe("mp3");
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain(ACCOUNT_B.uid);
  });
});

describe("socket handshake and connect failures (start frame never sent)", () => {
  const handshake = (statusCode, headers = {}) => (socket) => socket.listeners["unexpected-response"]?.({}, { statusCode, headers, resume() {} });

  it.each([
    [401, 401],
    [403, 401],
    [302, 502],
    [500, 502],
  ])("maps a %i upgrade answer to %i without an accepted job", async (upstream, status) => {
    serve(minted());
    scripts.push(handshake(upstream));
    const result = await speak();
    expect(result.status).toBe(status);
    expect(result.acceptedJob).toBeUndefined();
    expect(sockets[0].sent).toEqual([]);
    expect(sockets[0].terminated).toBe(true);
    await assertNoLeak(result);
  });

  it("keeps Retry-After on a 429 upgrade answer", async () => {
    serve(minted());
    scripts.push(handshake(429, { "retry-after": "12" }));
    const result = await speak();
    expect(result.status).toBe(429);
    expect(Number.isFinite(result.resetsAtMs)).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("maps a connection error before open to 502 without an accepted job", async () => {
    serve(minted());
    scripts.push((socket) => socket.onerror?.(new Error(`boom ${JWT_A}`)));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("maps a throwing constructor to 502", async () => {
    serve(minted());
    class Throwing {
      constructor() {
        throw new Error(`bad url ${JWT_A}`);
      }
    }
    const result = await speak({ adapter: { WebSocketImpl: Throwing } });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("bounds the handshake", async () => {
    serve(minted());
    scripts.push(() => {});
    const result = await speak({ adapter: { handshakeTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeUndefined();
    expect(sockets[0].terminated).toBe(true);
  });

  it("refuses before the socket when a strict proxy is required but missing", async () => {
    serve(minted());
    const result = await speak({ options: { proxyOptions: { strictProxy: true, disableEnvProxy: true } } });
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/proxy/);
    expect(sockets).toEqual([]);
  });
});

describe("cancellation and deadlines", () => {
  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await speak({ options: { signal: controller.signal } });
    expect(result.status).toBe(499);
    expect(fetchCalls).toEqual([]);
    expect(sockets).toEqual([]);
  });

  it("aborts during the mint without an accepted job", async () => {
    const controller = new AbortController();
    serve((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
      queueMicrotask(() => controller.abort());
    }));
    const result = await speak({ options: { signal: controller.signal } });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(sockets).toEqual([]);
  });

  it("terminates the socket and marks the job when aborted after the start frame", async () => {
    const controller = new AbortController();
    serve(minted());
    scripts.push((socket) => {
      socket.open();
      socket.message(dataFrame(PART_1));
      controller.abort();
    });
    const result = await speak({ options: { signal: controller.signal } });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toMatchObject({ modality: "tts", costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState: "accepted" } });
    expect(sockets[0].terminated).toBe(true);
    expect(sockets[0].sent).toHaveLength(1);
  });

  it("ends a stalled synthesis on the idle deadline", async () => {
    serve(minted());
    scripts.push((socket) => socket.open());
    const result = await speak({ adapter: { idleTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(sockets[0].terminated).toBe(true);
  });

  it("ends a trickling synthesis on the total deadline", async () => {
    serve(minted());
    scripts.push((socket) => {
      socket.open();
      const timer = setInterval(() => (socket.terminated ? clearInterval(timer) : socket.message(usageFrame(1))), 5);
    });
    const result = await speak({ adapter: { timeoutMs: 60, idleTimeoutMs: 1_000 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("uncertain accepted work is never replayed", () => {
  it.each([
    ["a socket error after send", (s) => { s.open(); s.onerror?.(new Error("reset")); }, 502, "submit-unknown"],
    ["an abnormal close after partial audio", (s) => { s.open(); s.message(dataFrame(PART_1)); s.end(1006); }, 502, "accepted"],
    ["a clean close with no audio", (s) => { s.open(); s.message(usageFrame(50)); s.end(1000); }, 502, "submit-unknown"],
  ])("%s carries acceptedJob and makes one attempt", async (_label, script, status, jobState) => {
    serve(minted());
    scripts.push(script);
    const result = await speak();
    expect(result.status).toBe(status);
    expect(result.acceptedJob.meta.jobState).toBe(jobState);
    expect(fetchCalls).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("flags an exhausted subscription quota on this connection", async () => {
    serve(minted());
    scripts.push(answers(usageFrame(100, true)));
    const result = await speak();
    expect(result.status).toBe(429);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("malformed and unsafe outputs", () => {
  it("fails on a chunk that is not strict base64", async () => {
    serve(minted());
    scripts.push(answers(dataFrame(PART_1), JSON.stringify({ data: "!!not-base64!!" }), dataFrame(PART_2)));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/undecodable/);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("refuses audio that is not MP3 instead of labeling it audio/mpeg", async () => {
    serve(minted());
    scripts.push(answers(dataFrame(Buffer.from("<html>upstream echo</html>"))));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/not MP3/);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("caps the total audio size", async () => {
    serve(minted());
    scripts.push(answers(dataFrame(PART_1), dataFrame(PART_2)));
    const result = await speak({ adapter: { maxAudioBytes: 200 } });
    expect(result.status).toBe(502);
    expect(await errorText(result)).toMatch(/size limit/);
    expect(sockets[0].terminated).toBe(true);
  });

  it("caps a single frame", async () => {
    serve(minted());
    scripts.push(answers(dataFrame(MP3)));
    const result = await speak({ adapter: { maxFrameBytes: 64 } });
    expect(result.status).toBe(502);
    expect(sockets[0].options.maxPayload).toBe(64);
  });

  it("ignores non-object JSON and empty data frames", async () => {
    serve(minted());
    scripts.push(answers("[1,2]", "42", JSON.stringify({ data: "" }), dataFrame(MP3)));
    const result = await speak();
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
  });
});
