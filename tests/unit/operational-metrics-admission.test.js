import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real auth, policy, limits, public decorators,
// translators and default batch executor; only provider execution is replaced.
// Execution requires the separately authorized offline parent/child sandbox.
const provider = vi.hoisted(() => ({ execute: vi.fn() }));
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
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected provider transport in admission fixture"); });
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
