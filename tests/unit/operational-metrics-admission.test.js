import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real auth, policy, limits, public decorators,
// translators and default batch executor; only provider execution is replaced.
// Execution requires the separately authorized offline parent/child sandbox.
const provider = vi.hoisted(() => ({ execute: vi.fn(), fetch: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExecutor: (providerId) => {
      const executor = actual.getExecutor(providerId);
      if (!["openai", "oa", "minimax"].includes(providerId)) return executor;
      return Object.assign(Object.create(executor), { execute: provider.execute });
    },
  };
});

const envNames = ["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"];
const globalNames = [
  "_dbAdapter", "_proxyTimelineAdapter", "_pendingRequests", "_lastErrorProvider",
  "_statsEmitter", "_pendingTimers", "_pendingCalls", "_recentRing",
  "_connectionMapCache", "_statsEmitTimers", "_activeSessions", "_activeSessionTimers",
  "_apiKeyLimitState", "__durindoorOperationalMetrics", "__durindoorMetricsSampler",
];
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let originalEnv, originalGlobals, listeners, directory, adapter, db;
let metrics, correlation, storage;
// Import each actual public handler at its test call. Eagerly loading every
// route in beforeAll made the fixture itself exceed the unchanged hook budget.
const postRoute = (load) => ({ POST: async (...args) => (await load()).POST(...args) });
const chat = postRoute(() => import("../../src/app/api/v1/chat/completions/route.js"));
const embeddings = postRoute(() => import("../../src/app/api/v1/embeddings/route.js"));
const images = postRoute(() => import("../../src/app/api/v1/images/generations/route.js"));
const speech = postRoute(() => import("../../src/app/api/v1/audio/speech/route.js"));
const native = postRoute(() => import("../../src/app/api/v1/native/[provider]/[...operation]/route.js"));
const legacy = postRoute(() => import("../../src/app/api/v1/completions/route.js"));
const gemini = postRoute(() => import("../../src/app/api/v1beta/models/[...path]/route.js"));
const files = postRoute(() => import("../../src/app/api/v1/files/route.js"));
const batches = postRoute(() => import("../../src/app/api/v1/batches/route.js"));
const systemone = postRoute(() => import("../../src/app/api/v1/systemone/route.js"));
const ollama = postRoute(() => import("../../src/app/api/v1/api/chat/route.js"));
const nativeEligibilityRoutes = [
  { name: "native background", path: "/v1/native/openai/v1/chat/completions", background: true,
    invoke: (req) => native.POST(req, { params: Promise.resolve({ provider: "openai", operation: ["v1", "chat", "completions"] }) }) },
  { name: "native session", path: "/v1/native/openai/v1/realtime/client_secrets",
    invoke: (req) => native.POST(req, { params: Promise.resolve({ provider: "openai", operation: ["v1", "realtime", "client_secrets"] }) }) },
  { name: "public realtime secret", path: "/v1/realtime/client_secrets", correlated: true,
    invoke: (req) => postRoute(() => import("../../src/app/api/v1/realtime/client_secrets/route.js")).POST(req) },
  { name: "public translation secret", path: "/v1/realtime/translations/client_secrets", correlated: true,
    invoke: (req) => postRoute(() => import("../../src/app/api/v1/realtime/translations/client_secrets/route.js")).POST(req) },
  { name: "public transcription session", path: "/v1/realtime/transcription_sessions", correlated: true,
    invoke: (req) => postRoute(() => import("../../src/app/api/v1/realtime/transcription_sessions/route.js")).POST(req) },
  { name: "public live session", path: "/v1/live/sessions", correlated: true,
    invoke: (req) => postRoute(() => import("../../src/app/api/v1/live/sessions/route.js")).POST(req) },
  { name: "native batch", path: "/v1/native/anthropic/v1/messages/batches", batch: true,
    invoke: (req) => native.POST(req, { params: Promise.resolve({ provider: "anthropic", operation: ["v1", "messages", "batches"] }) }) },
];
let baseline, keyNumber = 0;
const ownedBatchIds = [];
const reasons = ["auth_missing", "auth_invalid", "policy", "client_limit"];
const model = "openai/gpt-4o-mini";
const chatBody = { model, messages: [{ role: "user", content: "fixture" }], stream: false };
const geminiBody = { contents: [{ role: "user", parts: [{ text: "fixture" }] }] };
const request = (body = chatBody, headers = {}, url = "/v1/chat/completions") => new Request(`https://gateway.test${url}`, {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body),
});
const geminiContext = (nativeTts = false) => ({ params: Promise.resolve({ path: nativeTts
  ? ["gemini", "gemini-2.5-flash-preview-tts:generateContent"]
  : ["openai", "gpt-4o-mini:generateContent"] }) });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function sample() {
  const text = metrics.operationalMetricsText();
  const value = (name, absentIsZero = false) => {
    const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
    // The exact old-head reproduction has no client-denial series. Read that
    // absence as zero so its failure proves a missing selected-denial count,
    // rather than failing fixture setup before exercising the real route.
    if (!line && absentIsZero) return 0;
    expect(line, name).toBeDefined();
    return Number(line.slice(name.length + 1));
  };
  return {
    starts: value("durindoor_http_requests_total"), active: value("durindoor_http_active_requests"),
    ...Object.fromEntries(reasons.map((reason) => [reason, value(`durindoor_client_admission_failures_total{reason="${reason}"}`, true)])),
  };
}

function expectDelta(expected = {}) {
  const actual = sample();
  expect(Object.fromEntries(Object.keys(actual).map((name) => [name, actual[name] - baseline[name]])))
    .toEqual({ starts: 0, active: 0, auth_missing: 0, auth_invalid: 0, policy: 0, client_limit: 0, ...expected });
}

async function keyWithPolicy(value = {}) {
  return db.createApiKey(`admission-fixture-${++keyNumber}`, "synthetic-machine", [], null, null, { policy: value });
}

async function dailyKey(limit = 0) {
  return db.createApiKey(`daily-fixture-${++keyNumber}`, "synthetic-machine", [], limit);
}

// New producers: each entry names actual existing auth-denial returns. The
// three collection HEAD exports do not authenticate and are tested separately.
const resourceRoutes = [
  { path: "/v1/files", load: () => import("../../src/app/api/v1/files/route.js"), methods: ["GET", "POST"], collection: true },
  { path: "/v1/files/file_000000000000000000000000", load: () => import("../../src/app/api/v1/files/[id]/route.js"), methods: ["HEAD", "GET", "DELETE"] },
  { path: "/v1/files/file_000000000000000000000000/content", load: () => import("../../src/app/api/v1/files/[id]/content/route.js"), methods: ["GET"] },
  { path: "/v1/batches", load: () => import("../../src/app/api/v1/batches/route.js"), methods: ["GET", "POST"], collection: true },
  { path: "/v1/batches/batch_000000000000000000000000", load: () => import("../../src/app/api/v1/batches/[id]/route.js"), methods: ["GET"] },
  { path: "/v1/batches/batch_000000000000000000000000/cancel", load: () => import("../../src/app/api/v1/batches/[id]/cancel/route.js"), methods: ["POST"] },
  { path: "/v1/messages/batches", load: () => import("../../src/app/api/v1/messages/batches/route.js"), methods: ["GET", "POST"], collection: true },
  { path: "/v1/messages/batches/msgbatch_000000000000000000000000", load: () => import("../../src/app/api/v1/messages/batches/[id]/route.js"), methods: ["GET"] },
  { path: "/v1/messages/batches/msgbatch_000000000000000000000000/cancel", load: () => import("../../src/app/api/v1/messages/batches/[id]/cancel/route.js"), methods: ["POST"] },
  { path: "/v1/messages/batches/msgbatch_000000000000000000000000/results", load: () => import("../../src/app/api/v1/messages/batches/[id]/results/route.js"), methods: ["GET"] },
];

// ef75 coverage additions: real public wrappers for all annotated shared auth
// return sites, including polling/actions and native credential/session aliases.
// api/chat additionally needs the new final-Response metadata transfer.
const ef75AuthRoutes = [
  { path: "/v1/chat/completions", load: () => import("../../src/app/api/v1/chat/completions/route.js") },
  { path: "/v1/embeddings", load: () => import("../../src/app/api/v1/embeddings/route.js") },
  { path: "/v1/images/generations", load: () => import("../../src/app/api/v1/images/generations/route.js") },
  { path: "/v1/images/edits", load: () => import("../../src/app/api/v1/images/edits/route.js") },
  { path: "/v1/audio/speech", load: () => import("../../src/app/api/v1/audio/speech/route.js") },
  { path: "/v1/audio/transcriptions", load: () => import("../../src/app/api/v1/audio/transcriptions/route.js"), multipart: true },
  { path: "/v1/audio/translations", load: () => import("../../src/app/api/v1/audio/translations/route.js"), multipart: true },
  { path: "/v1/music/generations", load: () => import("../../src/app/api/v1/music/generations/route.js") },
  { path: "/v1/audio/music", load: () => import("../../src/app/api/v1/audio/music/route.js") },
  { path: "/v1/music/generations/fixture-job", load: () => import("../../src/app/api/v1/music/generations/[request_id]/route.js"), method: "GET", params: { request_id: "fixture-job" } },
  { path: "/v1/video/generations", load: () => import("../../src/app/api/v1/video/generations/route.js") },
  ...["generations", "edits", "extensions"].map((action) => ({ path: `/v1/videos/${action}`, load: () => import("../../src/app/api/v1/videos/[[...path]]/route.js"), params: { path: [action] } })),
  { path: "/v1/videos/fixture-job", load: () => import("../../src/app/api/v1/videos/[[...path]]/route.js"), method: "GET", params: { path: ["fixture-job"] } },
  { path: "/v1/rerank", load: () => import("../../src/app/api/v1/rerank/route.js") },
  { path: "/v1/search", load: () => import("../../src/app/api/v1/search/route.js") },
  { path: "/v1/web/fetch", load: () => import("../../src/app/api/v1/web/fetch/route.js") },
  { path: "/v1/moderations", load: () => import("../../src/app/api/v1/moderations/route.js") },
  { path: "/v1/systemone", load: () => import("../../src/app/api/v1/systemone/route.js") },
  { path: "/v1/messages/count_tokens", load: () => import("../../src/app/api/v1/messages/count_tokens/route.js"), fixedInvalidMessage: true },
  { path: "/v1/messages", load: () => import("../../src/app/api/v1/messages/route.js") },
  { path: "/v1/responses", load: () => import("../../src/app/api/v1/responses/route.js") },
  { path: "/v1/responses/compact", load: () => import("../../src/app/api/v1/responses/compact/route.js") },
  { path: "/v1/completions", load: () => import("../../src/app/api/v1/completions/route.js") },
  { path: "/v1/api/chat", load: () => import("../../src/app/api/v1/api/chat/route.js"), ndjson: true },
  { path: "/v1/realtime/client_secrets", load: () => import("../../src/app/api/v1/realtime/client_secrets/route.js") },
  { path: "/v1/realtime/transcription_sessions", load: () => import("../../src/app/api/v1/realtime/transcription_sessions/route.js") },
  { path: "/v1/realtime/translations/client_secrets", load: () => import("../../src/app/api/v1/realtime/translations/client_secrets/route.js") },
  { path: "/v1/live/sessions", load: () => import("../../src/app/api/v1/live/sessions/route.js") },
  ...["POST", "GET", "DELETE"].map((method) => ({ path: method === "POST" ? "/v1/native/openai/v1/chat/completions" : "/v1/native/openai/v1/responses/fixture-id", load: () => import("../../src/app/api/v1/native/[provider]/[...operation]/route.js"), method,
    params: { provider: "openai", operation: method === "POST" ? ["v1", "chat", "completions"] : ["v1", "responses", "fixture-id"] }, native: true })),
  { path: "/v1beta/models/gemini/gemini-2.5-flash-preview-tts:generateContent", load: () => import("../../src/app/api/v1beta/models/[...path]/route.js"), geminiTts: true,
    params: { path: ["gemini", "gemini-2.5-flash-preview-tts:generateContent"] } },
];

function authRequest(entry, reason) {
  const method = entry.method || "POST";
  const headers = reason === "invalid" ? { authorization: "Bearer synthetic-invalid" } : {};
  if (method === "GET" || method === "DELETE") return new Request(`https://gateway.test${entry.path}`, { method, headers });
  if (entry.multipart) {
    const form = new FormData();
    form.set("model", model);
    form.set("file", new File(["fixture"], "fixture.wav", { type: "audio/wav" }));
    return new Request(`https://gateway.test${entry.path}`, { method, headers, body: form });
  }
  return request(entry.geminiTts ? { ...geminiBody, generationConfig: { responseModalities: ["AUDIO"] } }
    : { ...chatBody, prompt: "fixture", input: "fixture", image: "data:image/png;base64,eA==", query: "fixture", url: "https://fixture.test", state: {}, questions: {} }, headers, entry.path);
}

beforeAll(async () => {
  const setupStarted = performance.now();
  const phase = (name) => console.info(`[admission fixture] ${name} ${Math.round(performance.now() - setupStarted)}ms`);
  originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd1129-admission-"));
  process.env.HOME = path.join(directory, "home");
  fs.mkdirSync(process.env.HOME, { mode: 0o700 });
  process.env.DATA_DIR = path.join(directory, "data");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  for (const name of globalNames) delete globalThis[name];
  vi.resetModules();
  vi.stubGlobal("fetch", provider.fetch.mockImplementation(() => { throw new Error("Unexpected provider transport in admission fixture"); }));
  phase("private environment");
  // Fixture setup needs only these repositories. Importing the whole DB barrel
  // eagerly pulled provider/routing modules into the 10s setup hook.
  const settings = await import("@/lib/db/repos/settingsRepo.js");
  phase("settings repository");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  phase("keys repository");
  const connections = await import("@/lib/db/repos/connectionsRepo.js");
  phase("connections repository");
  db = {
    updateSettings: settings.updateSettings, createApiKey: keys.createApiKey, getApiKeyByKey: keys.getApiKeyByKey,
    createProviderConnection: connections.createProviderConnection,
    saveRequestUsage: async (...args) => (await import("@/lib/db/repos/usageRepo.js")).saveRequestUsage(...args),
  };
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  phase("private adapter");
  for (const providerId of ["openai", "minimax"]) {
    await db.createProviderConnection({ provider: providerId, authType: "apikey", name: "fixture",
      apiKey: "synthetic-fixture-only", isActive: true });
    phase("synthetic connection");
  }
  metrics = await import("../../open-sse/services/operationalMetrics.js");
  correlation = await import("../../src/sse/utils/requestCorrelation.js");
  phase("correlation ready");
});

beforeEach(async () => {
  await db.updateSettings({ requireApiKey: true, enableProxyTimeline: false, visionBridgeEnabled: false });
  provider.fetch.mockClear();
  provider.execute.mockReset().mockImplementation(({ body, stream }) => {
    const completion = { id: "chat-fixture", object: "chat.completion", model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "provider reply" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    const response = stream ? new Response([
      { id: completion.id, object: "chat.completion.chunk", model: body.model,
        choices: [{ index: 0, delta: { role: "assistant", content: "provider reply" }, finish_reason: null }] },
      { id: completion.id, object: "chat.completion.chunk", model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: completion.usage },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    }) : Response.json(completion);
    return { response, url: "https://provider.test/v1/chat/completions", headers: {}, transformedBody: body };
  });
  baseline = sample();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(sample().active).toBe(baseline.active);
});

afterAll(async () => {
  try {
    for (const id of ownedBatchIds) await storage._waitForBatch(id);
    if (adapter) {
      await (await import("@/lib/db/repos/requestDetailsRepo.js")).disposeRequestDetailsRepo();
      await globalThis._proxyTimelineAdapter?.instance?.close?.();
      await adapter.close?.();
    }
  } finally {
    for (const name of ["_pendingTimers", "_activeSessionTimers", "_statsEmitTimers"]) {
      for (const timer of Object.values(globalThis[name] || {})) clearTimeout(timer);
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
      }
    }
    for (const [name, descriptor] of originalGlobals || []) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    for (const [name, value] of Object.entries(originalEnv || {})) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("selected client-admission failures", () => {
  it.each(["chat", "embeddings", "images", "speech", "native"].flatMap((route) =>
    ["missing", "invalid"].map((reason) => [route, reason])))("counts only the selected %s %s auth Response at EOF", async (route, reason) => {
    const routes = { chat, embeddings, images, speech };
    const paths = { chat: "/v1/chat/completions", embeddings: "/v1/embeddings", images: "/v1/images/generations", speech: "/v1/audio/speech" };
    const headers = reason === "invalid" ? { authorization: "Bearer synthetic-invalid" } : {};
    const body = { ...chatBody, input: "fixture", prompt: "fixture" };
    const response = routes[route] ? await routes[route].POST(request(body, headers, paths[route])) : await native.POST(request(body, headers), {
      params: Promise.resolve({ provider: "openai", operation: ["v1", "chat", "completions"] }),
    });
    expect(response.status).toBe(401);
    expectDelta({ starts: 1, active: 1 });
    expect((await response.json()).error.message).toBe(reason === "missing" ? "Missing API key" : "Invalid API key");
    expectDelta({ starts: 1, [`auth_${reason}`]: 1 });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("counts invalid auth once through shared and outer JSON correlation", async () => {
    const response = await chat.POST(request(chatBody, { authorization: "Bearer synthetic-invalid" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await response.json()).error.message).toBe("Invalid API key");
    expectDelta({ starts: 1, auth_invalid: 1 });
  });

  it("does not mark rejected credential candidates when a later header authenticates", async () => {
    const key = await keyWithPolicy();
    const response = await chat.POST(request(chatBody, { authorization: "Bearer synthetic-invalid", "x-api-key": key.key }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).choices[0].message.content).toBe("provider reply");
    expectDelta({ starts: 1 });
  });

  it("keeps local optional auth and real CLI bypass uncounted", async () => {
    await db.updateSettings({ requireApiKey: false });
    await (await chat.POST(request())).text();
    await db.updateSettings({ requireApiKey: true });
    const { getConsistentMachineId } = await import("@/shared/utils/machineId.js");
    const token = await getConsistentMachineId("9r-cli-auth");
    const bypass = await chat.POST(request(chatBody, { "x-9r-cli-token": token, authorization: "Bearer synthetic-invalid" }));
    expect(bypass.status).toBe(200);
    await bypass.text();
    expectDelta({ starts: 2 });
  });

  it("counts a selected policy denial once but no upstream work", async () => {
    const key = await keyWithPolicy({ allowedModels: ["minimax/MiniMax-M2.1"] });
    const response = await chat.POST(request(chatBody, { authorization: `Bearer ${key.key}` }));
    expect(response.status).toBe(403);
    expectDelta({ starts: 1, active: 1 });
    expect((await response.json()).error.message).toContain("not allowed");
    expectDelta({ starts: 1, policy: 1 });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("does not count the real vision-policy denial when chat keeps its original model", async () => {
    const log = await import("../../src/sse/utils/logger.js");
    const warnings = vi.spyOn(log, "warn");
    await db.updateSettings({ visionBridgeEnabled: true, visionBridgeModel: "openai/gpt-4o" });
    const key = await keyWithPolicy({ allowedModels: ["minimax/MiniMax-M2.1"] });
    const body = { ...chatBody, model: "minimax/MiniMax-M2.1", messages: [{ role: "user", content: [
      { type: "text", text: "fixture" }, { type: "image_url", image_url: { url: "data:image/png;base64,eA==" } },
    ] }] };
    const response = await chat.POST(request(body, { authorization: `Bearer ${key.key}` }));
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("provider reply");
    expect(provider.execute).toHaveBeenCalledOnce();
    expect(provider.execute.mock.calls[0][0].model).toBe("MiniMax-M2.1");
    expect(warnings.mock.calls.some(([, message]) => message.includes("Vision Bridge target") && message.includes("denied"))).toBe(true);
    expectDelta({ starts: 1 });
  });

  it("retains window limits, Retry-After and same-Request checked semantics", async () => {
    const limits = await import("@/lib/apiKeyLimits.js");
    const key = await keyWithPolicy({ rpmLimit: 1 });
    const record = await db.getApiKeyByKey(key.key);
    const first = request();
    expect(await limits.enforceApiKeyLimits(first, record)).toBeNull();
    expect(await limits.enforceApiKeyLimits(first, record)).toBeNull();
    const response = await chat.POST(request(chatBody, { authorization: `Bearer ${key.key}` }));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await response.json()).error.message).toContain("requests/minute");
    expectDelta({ starts: 1, client_limit: 1 });
  });

  it("counts lifetime allowance denial as client_limit, not policy", async () => {
    const key = await keyWithPolicy({ maxTokens: 1 });
    await db.saveRequestUsage({ provider: "openai", model: "gpt-4o-mini", apiKey: key.key,
      tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    const response = await chat.POST(request(chatBody, { authorization: `Bearer ${key.key}` }));
    expect(response.status).toBe(429);
    await response.text();
    expectDelta({ starts: 1, client_limit: 1 });
  });

  it.each(["/v1/chat/completions", "/v1/embeddings"])("does not turn denied default-executor %s rows into HTTP clients", async (url) => {
    const defaultExecutor = await import("../../open-sse/handlers/localBatchExecutor.js");
    const execute = defaultExecutor.makeDefaultExecutor(new Headers());
    const result = await execute({ url, body: url.endsWith("embeddings") ? { model, input: "fixture" } : chatBody });
    expect(result.status_code).toBe(401);
    expect(result.body.error.message).toBe("Missing API key");
    expectDelta();
  });

  it("counts batch HTTP operations while the real default executor consumes denied rows", async () => {
    storage = await import("../../open-sse/services/localFilesBatches.js");
    const key = await keyWithPolicy({ allowedModels: ["minimax/MiniMax-M2.1"] });
    const headers = { authorization: `Bearer ${key.key}` };
    const form = new FormData();
    form.set("purpose", "batch");
    form.set("file", new File([JSON.stringify({ custom_id: "denied-row", method: "POST",
      url: "/v1/chat/completions", body: chatBody }) + "\n"], "fixture.jsonl", { type: "application/jsonl" }));
    const upload = await files.POST(new Request("https://gateway.test/v1/files", { method: "POST", headers, body: form }));
    expect(upload.status).toBe(201);
    const file = await upload.json();
    const response = await batches.POST(request({ input_file_id: file.id, endpoint: "/v1/chat/completions", completion_window: "24h" }, headers, "/v1/batches"));
    expect(response.status).toBe(200);
    const batch = await response.json();
    ownedBatchIds.push(batch.id);
    await storage._waitForBatch(batch.id);
    const output = await storage.getBatchOutputText(batch.id, "output", { ownerId: key.id });
    expect(JSON.parse(output.trim()).response.status_code).toBe(403);
    expectDelta({ starts: 2 });
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it.each(["cancel", "EOF"])("retains a delayed legacy keepalive denial through %s", async (terminal) => {
    const { mapCompletionResponse } = await import("../../src/app/api/v1/completions/route.js");
    const selection = metrics.createClientAdmissionSelection();
    const source = selection.bind(new Response('data: {"error":{"message":"denied"}}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } }));
    const response = await metrics.observeHttpRequest(request({}), () => mapCompletionResponse(source));
    // Select after conversion, as the keepalive producer does after committing 200.
    selection.select(metrics.annotateClientAdmissionFailure(new Response(null, { status: 403 }), "policy"));
    expect(response.status).toBe(200);
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "cancel") {
      await response.body.cancel();
      expectDelta({ starts: 1 });
    } else {
      expect(await response.text()).toContain("denied");
      expectDelta({ starts: 1, policy: 1 });
    }
  });

  it("retains actual legacy derived Request identity through selected denial", async () => {
    const outer = request({ model, prompt: "fixture" }, {}, "/v1/completions");
    const response = await legacy.POST(outer);
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe(correlation.getRequestId(outer));
    expectDelta({ starts: 1, active: 1 });
    await response.text();
    expectDelta({ starts: 1, auth_missing: 1 });
  });

  it.each(["cancel", "EOF"])("lets final Gemini denial own %s after its real derivation", async (terminal) => {
    const response = await gemini.POST(request(geminiBody), geminiContext());
    expect(response.status).toBe(401);
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "cancel") {
      await response.body.cancel("fixture cancellation");
      expectDelta({ starts: 1 });
    } else {
      expect((await response.json()).error.message).toBe("Missing API key");
      expectDelta({ starts: 1, auth_missing: 1 });
    }
  });

  it("keeps Gemini parse failure separate from native TTS auth denial", async () => {
    const malformed = new Request("https://gateway.test/v1beta/models/openai/gpt-4o-mini:generateContent", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    });
    const parsed = await gemini.POST(malformed, geminiContext());
    expect(parsed.status).toBe(500);
    await parsed.text();
    expectDelta({ starts: 1 });
    const denied = await gemini.POST(request({ ...geminiBody, generationConfig: { responseModalities: ["AUDIO"] } }), geminiContext(true));
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.message).toBe("Missing API key");
    expectDelta({ starts: 2, auth_missing: 1 });
  });

  it("accounts HEAD at return without consuming or changing the actual annotated body", async () => {
    const response = metrics.annotateClientAdmissionFailure(new Response("deliberately unread", { status: 403 }), "policy");
    const observed = await metrics.observeHttpRequest(new Request("https://gateway.test", { method: "HEAD" }), () => response);
    expect(observed).toBe(response);
    expect(observed.bodyUsed).toBe(false);
    expectDelta({ starts: 1, policy: 1 });
  });

  it("keeps denial status, headers and payload intact while correlation copies only weak metadata", async () => {
    const source = new Response(JSON.stringify({ error: { message: "fixture denial" } }), {
      status: 429, statusText: "fixture status", headers: { "content-type": "application/json", "retry-after": "9", "x-fixture": "preserved" },
    });
    expect(metrics.annotateClientAdmissionFailure(source, "client_limit")).toBe(source);
    const boundary = correlation.withHttpRequestCorrelation(async () =>
      correlation.correlateResponse(source, "trusted-fixture-id"));
    const response = await boundary(request());
    expect(response.status).toBe(429);
    expect(response.statusText).toBe("fixture status");
    expect(response.headers.get("retry-after")).toBe("9");
    expect(response.headers.get("x-fixture")).toBe("preserved");
    const body = await response.json();
    expect(body.error.message).toBe("fixture denial");
    expect(body.error.upstream_request_id).toBe("trusted-fixture-id");
    expect(Object.keys(body.error).sort()).toEqual(["message", "request_id", "upstream_request_id"]);
    expect([...response.headers.keys()]).toEqual(["content-type", "retry-after", "x-fixture", "x-request-id"]);
    expectDelta({ starts: 1, client_limit: 1 });
  });

  it("finishes a reused Request observation only once even when another denial is returned", async () => {
    const reused = request();
    const boundary = correlation.withHttpRequestCorrelation(() =>
      metrics.annotateClientAdmissionFailure(new Response("denied", { status: 403 }), "policy"));
    await (await boundary(reused)).text();
    await (await boundary(reused)).text();
    expectDelta({ starts: 1, policy: 1 });
  });

  it("keeps never-consumed denial pending until cancellation without counting admission", async () => {
    const response = await chat.POST(request());
    expect(response.bodyUsed).toBe(false);
    expectDelta({ starts: 1, active: 1 });
    await response.body.cancel("unused final body");
    expectDelta({ starts: 1 });
  });

  it("does not infer local denial from upstream status, transport failure or intentional abort", async () => {
    const boundary = correlation.withHttpRequestCorrelation(() => Response.json({ error: { message: "provider failure" } }, { status: 429 }));
    await (await boundary(request())).text();
    const broken = metrics.annotateClientAdmissionFailure(new Response(new ReadableStream({
      pull(controller) { controller.error(new Error("fixture transport error")); },
    }), { status: 403 }), "policy");
    const failed = await metrics.observeHttpRequest(request(), () => broken);
    await expect(failed.text()).rejects.toThrow("fixture transport error");
    const abort = new AbortController();
    abort.abort("intentional client abort");
    const aborted = await chat.POST(new Request(request(), { signal: abort.signal }));
    await aborted.text();
    expectDelta({ starts: 3 });
  });

  it("does not count an annotated candidate when its handler throws instead of selecting it", async () => {
    const boundary = correlation.withHttpRequestCorrelation(() => {
      metrics.annotateClientAdmissionFailure(new Response(null, { status: 403 }), "policy");
      throw new Error("fixture handler failure");
    });
    const response = await boundary(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe("Request failed");
    expectDelta({ starts: 1 });
  });

  it("does not collapse distinct nested or concurrent requests with identical correlation strings", async () => {
    const make = () => {
      const value = request();
      correlation.getRequestId(value, "same-trusted-fixture-id");
      return value;
    };
    const first = make(), second = make();
    const responses = await Promise.all([chat.POST(first), chat.POST(second)]);
    await Promise.all(responses.map((response) => response.text()));
    const outer = make(), distinct = make();
    await metrics.observeHttpRequest(outer, async () => {
      const nested = await chat.POST(distinct);
      await nested.text();
      return new Response(null, { status: 204 });
    });
    expectDelta({ starts: 4, auth_missing: 3 });
  });

  it.each(["EOF", "cancel", "cancel-after-enqueue", "body-error"])("transfers only selected delayed denial through HTTP 200 and final %s", async (terminal) => {
    const policy = await import("../../src/sse/services/apiKeyPolicy.js");
    const keepalive = await import("../../open-sse/utils/earlyStreamKeepalive.js");
    const key = await keyWithPolicy({ allowedModels: ["minimax/MiniMax-M2.1"] });
    const source = await policy.enforceApiKeyModelPolicy(request(), model, key.key);
    expect(source.status).toBe(403);
    const chosen = terminal === "body-error"
      ? metrics.copyClientAdmissionFailure(source, new Response(new ReadableStream({
        pull(controller) { controller.error(new Error("denial body failed")); },
      }), { status: 403 })) : source;
    const handler = deferred();
    vi.useFakeTimers();
    const boundary = correlation.withHttpRequestCorrelation(() => keepalive.withEarlyStreamKeepalive(handler.promise, {
      thresholdMs: 1, intervalMs: 250,
    }));
    const pending = boundary(request());
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(200);
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "cancel") await response.body.cancel("client gone before final denial");
    handler.resolve(chosen);
    if (terminal === "cancel-after-enqueue") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain("keepalive");
      expect(decoder.decode((await reader.read()).value)).toContain("not allowed");
      expectDelta({ starts: 1, active: 1 });
      await reader.cancel("client cancelled after denial frame, before EOF");
      expectDelta({ starts: 1 });
    } else if (terminal !== "cancel") {
      expect(await response.text()).toContain("data:");
      expectDelta({ starts: 1, ...(terminal === "EOF" ? { policy: 1 } : {}) });
    } else {
      await handler.promise;
      expectDelta({ starts: 1 });
    }
  });

  it("keeps a selected fast-path denial Response unchanged", async () => {
    const keepalive = await import("../../open-sse/utils/earlyStreamKeepalive.js");
    const response = metrics.annotateClientAdmissionFailure(new Response(null, { status: 403 }), "policy");
    expect(await keepalive.withEarlyStreamKeepalive(Promise.resolve(response), { intervalMs: 0 })).toBe(response);
    expect(await keepalive.withEarlyStreamKeepalive(Promise.resolve(response))).toBe(response);
    expectDelta();
  });

  it("exports exactly four fixed denial labels, never the credential, URL, ID or arbitrary reason", async () => {
    const privateValue = "fixture-private-dimension";
    const response = metrics.annotateClientAdmissionFailure(new Response(null, { status: 429 }), privateValue);
    await metrics.observeHttpRequest(new Request(`https://gateway.test/${privateValue}`), () => response);
    const lines = metrics.operationalMetricsText().split("\n").filter((line) => line.startsWith("durindoor_client_admission_failures_total{"));
    expect(lines.map((line) => line.match(/reason="([^"]+)"/)[1])).toEqual(reasons);
    expect(metrics.operationalMetricsText()).not.toContain(privateValue);
    expectDelta({ starts: 1 });
  });
});

describe("new Files/Batches auth producers", () => {
  const denials = resourceRoutes.flatMap((entry) => entry.methods.flatMap((method) =>
    ["missing", "invalid"].map((reason) => ({ ...entry, method, reason }))));

  it.each(denials)("marks only selected $method $path $reason denial", async (entry) => {
    const route = await entry.load();
    const headers = entry.reason === "invalid" ? { authorization: "Bearer synthetic-invalid" } : {};
    const req = new Request(`https://gateway.test${entry.path}`, { method: entry.method, headers });
    const response = await route[entry.method](req, { params: Promise.resolve({ id: "unused-before-auth" }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-request-id")).toBe(correlation.getRequestId(req));
    expect([...response.headers.keys()]).not.toContain("denialreason");
    if (entry.method === "HEAD") {
      expect(response.body).toBeNull();
      expect(response.bodyUsed).toBe(false);
    } else {
      expectDelta({ starts: 1, active: 1 });
      const body = await response.json();
      expect(body.error.message).toBe("Invalid API key");
      expect(Object.keys(body.error).sort()).toEqual(["code", "message", "request_id", "type"]);
      expect(JSON.stringify(body)).not.toMatch(/denialReason|auth_missing|auth_invalid|synthetic-invalid/);
    }
    expectDelta({ starts: 1, [`auth_${entry.reason}`]: 1 });
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it.each(resourceRoutes)("keeps $path OPTIONS and collection HEAD behavior", async (entry) => {
    const route = await entry.load();
    const response = await route.OPTIONS(new Request(`https://gateway.test${entry.path}`, { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expectDelta();
    if (entry.collection) {
      const head = await route.HEAD(new Request(`https://gateway.test${entry.path}`, { method: "HEAD" }));
      expect(head.status).toBe(200);
      expect(head.body).toBeNull();
      expectDelta({ starts: 1 });
    }
  });

  it.each(["cancel", "abort"])("does not count a Files denial after %s", async (terminal) => {
    const route = await resourceRoutes[0].load();
    const abort = new AbortController();
    const response = await route.GET(new Request("https://gateway.test/v1/files", { signal: abort.signal }));
    expect(response.status).toBe(401);
    expect(response.bodyUsed).toBe(false);
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "abort") abort.abort("client left before EOF");
    await response.body.cancel("client left before EOF");
    expectDelta({ starts: 1 });
  });

  it("keeps recovered credentials, optional local auth and operator success unmarked", async () => {
    const route = await resourceRoutes[0].load();
    const key = await keyWithPolicy();
    const recovered = await route.GET(new Request("https://gateway.test/v1/files", {
      headers: { authorization: "Bearer synthetic-invalid", "x-api-key": key.key },
    }));
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).object).toBe("list");
    await db.updateSettings({ requireApiKey: false });
    const local = await route.GET(new Request("https://gateway.test/v1/files"));
    expect(local.status).toBe(200);
    await local.text();
    await db.updateSettings({ requireApiKey: true });
    const { getConsistentMachineId } = await import("@/shared/utils/machineId.js");
    const operator = await route.GET(new Request("https://gateway.test/v1/files", {
      headers: { "x-9r-cli-token": await getConsistentMachineId("9r-cli-auth"), authorization: "Bearer synthetic-invalid" },
    }));
    expect(operator.status).toBe(200);
    await operator.text();
    expectDelta({ starts: 3 });
  });

  it("does not guess admission from foreign/missing 404, filtered lists or validation 400/415", async () => {
    storage = await import("../../open-sse/services/localFilesBatches.js");
    const owner = await keyWithPolicy(), other = await keyWithPolicy();
    const file = await storage.uploadFile({ filename: "private.txt", bytes: "fixture", purpose: "batch" }, { ownerId: owner.id });
    const detail = await resourceRoutes[1].load();
    for (const id of [file.id, "file_000000000000000000000000"]) {
      const response = await detail.GET(new Request(`https://gateway.test/v1/files/${id}`, {
        headers: { authorization: `Bearer ${other.key}` },
      }), { params: Promise.resolve({ id }) });
      expect(response.status).toBe(404);
      expect((await response.json()).error.message).toBe("file not found");
    }
    const collection = await resourceRoutes[0].load();
    const listed = await collection.GET(new Request("https://gateway.test/v1/files", { headers: { authorization: `Bearer ${other.key}` } }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).data).toEqual([]);
    const unsupported = await files.POST(request({}, { authorization: `Bearer ${other.key}` }, "/v1/files"));
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).error.message).toBe("Content-Type must be multipart/form-data");
    const invalid = await batches.POST(request({}, { authorization: `Bearer ${other.key}` }, "/v1/batches"));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.message).toBe("input_file_id is required");
    expectDelta({ starts: 5 });
  });

  it("keeps pending Anthropic results 409 separate from local admission denial", async () => {
    storage = await import("../../open-sse/services/localFilesBatches.js");
    const key = await keyWithPolicy();
    const headers = { authorization: `Bearer ${key.key}` };
    const entered = deferred(), release = deferred();
    const execute = provider.execute.getMockImplementation();
    provider.execute.mockImplementationOnce(async (options) => {
      entered.resolve();
      await release.promise;
      return execute(options);
    });
    const collection = await resourceRoutes[6].load();
    const response = await collection.POST(request({ requests: [{ custom_id: "pending-row", params: chatBody }] }, headers, "/v1/messages/batches"));
    expect(response.status).toBe(200);
    const batch = await response.json();
    ownedBatchIds.push(batch.id);
    try {
      await entered.promise;
      const results = await resourceRoutes[9].load();
      const pending = await results.GET(new Request(`https://gateway.test/v1/messages/batches/${batch.id}/results`, { headers }),
        { params: Promise.resolve({ id: batch.id }) });
      expect(pending.status).toBe(409);
      expect((await pending.json()).error.message).toBe("message batch has not ended yet");
      expectDelta({ starts: 2 });
    } finally {
      release.resolve();
      await storage._waitForBatch(batch.id);
    }
    expectDelta({ starts: 2 });
  });
});

describe("new selected daily-token denial producers", () => {
  it.each(["chat", "native", "systemone"].flatMap((route) =>
    ["EOF", "cancel", "abort"].map((terminal) => [route, terminal])))("counts real %s daily denial only at %s clean completion", async (route, terminal) => {
    const key = await dailyKey();
    const abort = new AbortController();
    const req = new Request(request(route === "systemone" ? { model, state: {}, questions: {} } : chatBody,
      { authorization: `Bearer ${key.key}` }, route === "systemone" ? "/v1/systemone" : "/v1/chat/completions"), { signal: abort.signal });
    const response = route === "native" ? await native.POST(req, {
      params: Promise.resolve({ provider: "openai", operation: ["v1", "chat", "completions"] }),
    }) : await (route === "chat" ? chat : systemone).POST(req);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "EOF") {
      if (route === "chat") expect((await response.json()).error.message).toBe("API key daily token limit exceeded (0/0 tokens)");
      else expect(await response.text()).toBe("API key daily token limit reached");
      expectDelta({ starts: 1, client_limit: 1 });
    } else {
      if (terminal === "abort") abort.abort("daily denial not delivered");
      await response.body.cancel("daily denial not delivered");
      expectDelta({ starts: 1 });
    }
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("does not count discarded daily denials or post-commit quota checks against a successful HTTP result", async () => {
    const usage = await import("../../src/sse/services/nativeUsage.js");
    const exhausted = await dailyKey();
    const spent = await dailyKey(1);
    const req = request();
    const billingEpoch = await correlation.captureRequestBillingEpoch(req);
    const boundary = correlation.withHttpRequestCorrelation(async () => {
      const candidate = await usage.nativeUsageAdmission(exhausted.key);
      expect(candidate.status).toBe(429);
      expect(await candidate.text()).toBe("API key daily token limit reached");
      expect(await usage.recordNativeUsage({ apiKey: spent.key, provider: "openai", model: "gpt-4o-mini",
        connectionId: "fixture-account", endpoint: "/v1/responses", usageEventId: `post-commit-${spent.id}`, billingEpoch,
        modality: "chat", tokens: { input_tokens: 1, output_tokens: 1 }, nativeUnits: {},
        cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable" })).toBe(false);
      return new Response("successful provider result");
    });
    const response = await boundary(req);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("successful provider result");
    expectDelta({ starts: 1 });
  });

  it("does not turn actual missing daily-usage storage into a client-limit denial", async () => {
    const key = await dailyKey(10);
    // Inject a real query failure only in this fixture's private database.
    adapter.exec("ALTER TABLE usageHistory RENAME TO admission_fixture_usageHistory");
    let response;
    try {
      response = await chat.POST(request(chatBody, { authorization: `Bearer ${key.key}` }));
    } finally {
      adapter.exec("ALTER TABLE admission_fixture_usageHistory RENAME TO usageHistory");
    }
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toBe("Database temporarily unavailable");
    expectDelta({ starts: 1 });
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("keeps real default-executor daily 429 rows separate from successful batch HTTP operations", async () => {
    storage = await import("../../open-sse/services/localFilesBatches.js");
    const key = await dailyKey();
    const headers = { authorization: `Bearer ${key.key}` };
    const form = new FormData();
    form.set("purpose", "batch");
    form.set("file", new File([JSON.stringify({ custom_id: "daily-row", method: "POST", url: "/v1/chat/completions", body: chatBody }) + "\n"], "daily.jsonl", { type: "application/jsonl" }));
    const upload = await files.POST(new Request("https://gateway.test/v1/files", { method: "POST", headers, body: form }));
    expect(upload.status).toBe(201);
    const file = await upload.json();
    const response = await batches.POST(request({ input_file_id: file.id, endpoint: "/v1/chat/completions", completion_window: "24h" }, headers, "/v1/batches"));
    expect(response.status).toBe(200);
    const batch = await response.json();
    ownedBatchIds.push(batch.id);
    await storage._waitForBatch(batch.id);
    const output = await storage.getBatchOutputText(batch.id, "output", { ownerId: key.id });
    expect(JSON.parse(output.trim()).response).toMatchObject({ status_code: 429,
      body: { error: { message: "API key daily token limit exceeded (0/0 tokens)" } } });
    expectDelta({ starts: 2 });
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });
});

describe("configured native eligibility denial producers", () => {
  const bodyFor = (entry) => entry.batch ? { model: "anthropic/claude-haiku-4-5", requests: [] }
    : entry.background ? { ...chatBody, background: true } : { model };
  const messageFor = (entry) => entry.background || entry.batch
    ? "Usage-capped API keys cannot delegate native background or batch inference"
    : "Usage-capped API keys cannot mint direct native sessions";
  const wireFor = (message, requestId = null) => JSON.stringify({ error: {
    message, type: "permission_error", code: "permission_denied", ...(requestId ? { request_id: requestId } : {}),
  } });
  const noDispatch = () => {
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  };

  it.each(nativeEligibilityRoutes.flatMap((entry) =>
    ["EOF", "unread-then-cancel", "abort"].map((terminal) => [entry.name, terminal, entry])))(
    "counts %s configured refusal only at %s clean completion", async (_name, terminal, entry) => {
      // A positive, unspent daily cap still disallows delegated execution.
      const key = await dailyKey(100);
      const abort = new AbortController();
      const req = new Request(request(bodyFor(entry), { authorization: `Bearer ${key.key}` }, entry.path), { signal: abort.signal });
      const response = await entry.invoke(req);
      const requestId = entry.correlated ? correlation.getRequestId(req) : null;
      expect(response.status).toBe(403);
      expect(Object.fromEntries(response.headers)).toEqual({
        "access-control-allow-origin": "*", "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}),
      });
      expect(response.bodyUsed).toBe(false);
      expectDelta({ starts: 1, active: 1 });
      if (terminal === "EOF") {
        expect(await response.text()).toBe(wireFor(messageFor(entry), requestId));
        expectDelta({ starts: 1, policy: 1 });
        // An already completed observation cannot count a second terminal.
        abort.abort("after clean EOF");
        expectDelta({ starts: 1, policy: 1 });
      } else {
        if (terminal === "abort") abort.abort("configured denial not delivered");
        else {
          await Promise.resolve();
          expect(response.bodyUsed).toBe(false);
          expectDelta({ starts: 1, active: 1 });
        }
        await response.body.cancel("configured denial not delivered");
        expectDelta({ starts: 1 });
      }
      noDispatch();
    });

  it.each(nativeEligibilityRoutes.slice(0, 2).flatMap((entry) =>
    ["daily-zero", "token-cap", "cost-cap", "request-window"].map((cap) => [entry.name, cap, entry])))(
    "keeps %s %s eligibility in policy rather than exhausted allowance", async (_name, cap, entry) => {
      const key = cap === "daily-zero" ? await dailyKey(0) : await keyWithPolicy(cap === "token-cap"
        ? { maxTokens: 100 } : cap === "cost-cap" ? { maxCostUsd: 100 } : { rpmLimit: 100 });
      const response = await entry.invoke(request(bodyFor(entry), { authorization: `Bearer ${key.key}` }, entry.path));
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(wireFor(messageFor(entry)));
      expectDelta({ starts: 1, policy: 1 });
      noDispatch();
    });

  it.each(nativeEligibilityRoutes.slice(0, 2).flatMap((entry) =>
    ["auth_missing", "auth_invalid", "allowlist", "malformed"].map((earlier) => [entry.name, earlier, entry])))(
    "preserves the earlier %s %s outcome", async (_name, earlier, entry) => {
      let headers = {}, message = "Missing API key";
      if (earlier === "auth_invalid") {
        headers = { authorization: "Bearer synthetic-invalid" };
        message = "Invalid API key";
      } else if (["allowlist", "malformed"].includes(earlier)) {
        const key = await keyWithPolicy(earlier === "allowlist" ? { allowedModels: ["openai/not-this-model"] } : {});
        if (earlier === "malformed") adapter.run("UPDATE apiKeys SET policy = ? WHERE id = ?", ["{", key.id]);
        headers = { authorization: `Bearer ${key.key}` };
        message = earlier === "malformed" ? "API key policy is invalid; contact the administrator"
          : 'Model "openai/gpt-4o-mini" is not allowed for this API key';
      }
      const response = await entry.invoke(request(bodyFor(entry), headers, entry.path));
      const auth = earlier.startsWith("auth_");
      expect(response.status).toBe(auth ? 401 : 403);
      expect(await response.text()).toBe(auth ? JSON.stringify({ error: {
        message, type: "authentication_error", code: "invalid_api_key",
      } }) : wireFor(message));
      expectDelta({ starts: 1, [auth ? earlier : "policy"]: 1 });
      noDispatch();
    });

  it.each(["HEAD", "bodyless", "body-error"])(
    "preserves a real selected eligibility cell through the %s observer contract", async (terminal) => {
      // Native routes have no HEAD export and their refusals have JSON bodies.
      // These explicit adapters test observation/metadata contracts; they do
      // not claim a public native HEAD or bodyless producer exists.
      const key = await dailyKey(100);
      const { handleOpenAINativeSession } = await import("../../src/sse/handlers/nativeProvider.js");
      const selected = await handleOpenAINativeSession(request({ model }, { authorization: `Bearer ${key.key}` }), "/v1/realtime/client_secrets");
      expect(selected.status).toBe(403);
      expectDelta();
      const body = selected.body;
      let target = selected;
      const failure = new Error("synthetic downstream body failure");
      if (terminal !== "HEAD") {
        target = metrics.copyClientAdmissionFailure(selected, new Response(terminal === "bodyless" ? null : new ReadableStream({
          pull(controller) { controller.error(failure); },
        }, { highWaterMark: 0 }), { status: selected.status, headers: selected.headers }));
        await selected.body.cancel("explicit test adapter owns replacement");
      }
      const req = new Request("https://gateway.test/observer-contract", { method: terminal === "HEAD" ? "HEAD" : "POST" });
      const response = await metrics.observeHttpRequest(req, () => target);
      if (terminal === "body-error") {
        expectDelta({ starts: 1, active: 1 });
        await expect(response.text()).rejects.toBe(failure);
        expectDelta({ starts: 1 });
      } else {
        expect(response).toBe(target);
        expectDelta({ starts: 1, policy: 1 });
        if (terminal === "HEAD") {
          expect(response.body).toBe(body);
          expect(response.bodyUsed).toBe(false);
          await response.body.cancel("HEAD transport discards unread body");
        } else expect(response.body).toBeNull();
        expectDelta({ starts: 1, policy: 1 });
      }
      noDispatch();
    });

  it.each([
    ["native background", 403, nativeEligibilityRoutes[0]],
    ...nativeEligibilityRoutes.slice(1, 3).flatMap((entry) => [200, 403].map((status) => [entry.name, status, entry])),
  ])("leaves eligible %s upstream HTTP %s unannotated", async (_name, status, entry) => {
    const key = await keyWithPolicy();
    const payload = status === 200 ? '{"value":"synthetic-session","expires_at":1}'
      : '{"error":{"message":"upstream configured refusal"}}';
    provider.fetch.mockImplementationOnce(async (url, options) => {
      expect(String(url)).toBe(entry.background ? "https://api.openai.com/v1/chat/completions"
        : "https://api.openai.com/v1/realtime/client_secrets");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ ...bodyFor(entry), model: "gpt-4o-mini" });
      return new Response(payload, { status, headers: { "content-type": "application/json" } });
    });
    const req = request(bodyFor(entry), { authorization: `Bearer ${key.key}` }, entry.path);
    const response = await entry.invoke(req);
    expect(response.status).toBe(status);
    const requestId = entry.correlated ? correlation.getRequestId(req) : null;
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe(status === 200 ? payload : wireFor("upstream configured refusal", requestId));
    expectDelta({ starts: 1 });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("does not observe discarded internal refusals or realtime control responses as clients", async () => {
    const key = await dailyKey(100);
    const { handleOpenAINativeSession } = await import("../../src/sse/handlers/nativeProvider.js");
    const boundary = correlation.withHttpRequestCorrelation(async () => {
      const discarded = await handleOpenAINativeSession(request({ model }, { authorization: `Bearer ${key.key}` }), "/v1/realtime/client_secrets");
      expect(discarded.status).toBe(403);
      expect(await discarded.text()).toBe(wireFor(messageFor(nativeEligibilityRoutes[1])));
      const authControl = await import("../../src/app/api/v1/realtime/auth/route.js");
      const auth = await authControl.GET(new Request("https://gateway.test/api/v1/realtime/auth"));
      expect(auth.status).toBe(401);
      expect((await auth.json()).error.message).toBe("Missing API key");
      const nativeControl = await import("../../src/app/api/v1/realtime/native/route.js");
      const control = await nativeControl.POST(request({ model }, {}, "/api/v1/realtime/native"));
      expect(control.status).toBe(404);
      expect(await control.text()).toBe("Not Found");
      return new Response("selected independent success");
    });
    const response = await boundary(request());
    expect(await response.text()).toBe("selected independent success");
    expectDelta({ starts: 1 });
    noDispatch();
  });
});

describe("ef75 auth-wrapper coverage and selected Ollama transfer", () => {
  it.each(ef75AuthRoutes.flatMap((entry) => ["missing", "invalid"].flatMap((reason) =>
    ["EOF", "cancel"].map((terminal) => ({ ...entry, reason, terminal })))))("keeps $path $method $reason $terminal auth accounting and wire", async (entry) => {
    const route = await entry.load();
    const req = authRequest(entry, entry.reason);
    const response = await route[entry.method || "POST"](req, { params: Promise.resolve(entry.params || {}) });
    const message = entry.reason === "missing" && !entry.fixedInvalidMessage ? "Missing API key" : "Invalid API key";
    expect(response.status).toBe(401);
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("content-type")).toContain(entry.ndjson ? "application/x-ndjson" : "application/json");
    if (!entry.geminiTts) expect(response.headers.get("access-control-allow-origin")).toBe("*");
    if (entry.native || entry.geminiTts) expect(response.headers.get("x-request-id")).toBeNull();
    else expect(response.headers.get("x-request-id")).toBe(correlation.getRequestId(req));
    expectDelta({ starts: 1, active: 1 });
    if (entry.terminal === "EOF") {
      const text = await response.text();
      // Existing outer JSON-error correlation also parses a single NDJSON
      // error line, retaining its media type but serializing the correlated
      // object without a trailing newline. The metadata copy must preserve it.
      if (entry.ndjson) expect(text).toBe(JSON.stringify({ error: message, request_id: correlation.getRequestId(req) }));
      else {
        const body = JSON.parse(text);
        expect(body.error.message).toBe(message);
        expect(text).not.toMatch(/denialReason|auth_missing|auth_invalid|synthetic-invalid/);
      }
      expectDelta({ starts: 1, [`auth_${entry.reason}`]: 1 });
    } else {
      await response.body.cancel("public auth denial unread");
      expectDelta({ starts: 1 });
    }
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it.each(["messages", "responses"].flatMap((route) => ["EOF", "abort-after-enqueue"].map((terminal) => [route, terminal])))("keeps actual %s delayed denial frames and selected %s accounting", async (route, terminal) => {
    // Load the real decorator/route before controlling time. Only this input
    // Request's original JSON read is delayed; handleChat/auth/policy stay real.
    const selected = await (route === "messages" ? import("../../src/app/api/v1/messages/route.js") : import("../../src/app/api/v1/responses/route.js"));
    const abort = new AbortController();
    const req = new Request(request(route === "messages" ? { ...chatBody, stream: true, max_tokens: 8 }
      : { model, input: "fixture", stream: true }, {}, `/v1/${route}`), { signal: abort.signal });
    const reading = deferred(), release = deferred();
    const originalJson = req.json.bind(req);
    vi.spyOn(req, "json").mockImplementation(async () => {
      reading.resolve();
      await release.promise;
      return originalJson();
    });
    vi.useFakeTimers();
    const pending = selected.POST(req);
    await reading.promise;
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-cache, no-transform", connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8", "x-request-id": correlation.getRequestId(req),
    });
    const reader = response.body.getReader(), decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe(route === "messages" ? 'event: ping\ndata: {"type":"ping"}\n\n' : ": keepalive\n\n");
    release.resolve();
    const frame = decoder.decode((await reader.read()).value);
    const payload = JSON.parse(frame.split("\n").find((line) => line.startsWith("data: ")).slice(6));
    expect(frame.startsWith("event: error\ndata: ")).toBe(true);
    if (route === "messages") expect(payload).toEqual({ type: "error", error: {
      type: "authentication_error", message: "Missing API key", status_code: 401,
    } });
    else expect(payload).toEqual({ type: "error", code: "invalid_api_key", message: "Missing API key", param: null,
      sequence_number: 1, status_code: 401, error_type: "authentication_error" });
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "abort-after-enqueue") abort.abort("request aborted after selected error frame");
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    reader.releaseLock();
    expectDelta({ starts: 1, ...(terminal === "EOF" ? { auth_missing: 1 } : {}) });
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("preserves successful Ollama output and leaves upstream error frames unannotated", async () => {
    const key = await keyWithPolicy();
    const headers = { authorization: `Bearer ${key.key}` };
    const successful = await ollama.POST(request(chatBody, headers, "/v1/api/chat"));
    expect(successful.status).toBe(200);
    expect(successful.headers.get("content-type")).toBe("application/x-ndjson");
    const text = await successful.text();
    expect(text.endsWith("\n")).toBe(true);
    const rows = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "gpt-4o-mini", message: { role: "assistant", content: "provider reply" }, done: true });
    expectDelta({ starts: 1 });
    // A provider-origin error inside a successful transport stream is not a
    // locally annotated denial, regardless of its in-band status/code fields.
    provider.execute.mockImplementationOnce(({ body }) => ({
      response: new Response('data: {"id":"provider-stream","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"before-error"},"finish_reason":null}]}\n\ndata: {"error":{"message":"provider denied","code":"invalid_api_key","status_code":401}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.test/v1/chat/completions", headers: {}, transformedBody: body,
    }));
    const upstream = await ollama.POST(request({ ...chatBody, stream: true }, headers, "/v1/api/chat"));
    expect(upstream.status).toBe(200);
    expect(upstream.headers.get("content-type")).toBe("application/x-ndjson");
    const upstreamText = await upstream.text();
    expect(upstreamText).toContain('"content":"before-error"');
    expect(upstreamText).toContain('{"error":"provider denied"}\n');
    expect(provider.execute).toHaveBeenCalledTimes(2);
    expectDelta({ starts: 2 });
  });
});
