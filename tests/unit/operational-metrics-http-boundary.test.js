import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real route decorators, auth, shared handlers, translators and default batch
// executor. Only provider execution/transport is replaced. Run in the assigned
// offline parent/child sandbox; the fixture itself is not network isolation.
const provider = vi.hoisted(() => ({ execute: vi.fn(), fetch: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExecutor: (providerId) => {
      const executor = actual.getExecutor(providerId);
      if (providerId !== "openai" && providerId !== "oa") return executor;
      return Object.assign(Object.create(executor), { execute: provider.execute });
    },
  };
});

const envNames = ["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"];
const globalNames = [
  "_dbAdapter", "_proxyTimelineAdapter", "_pendingRequests", "_lastErrorProvider",
  "_statsEmitter", "_pendingTimers", "_pendingCalls", "_recentRing",
  "_connectionMapCache", "_statsEmitTimers", "_activeSessions", "_activeSessionTimers",
  "__durindoorOperationalMetrics", "__durindoorMetricsSampler",
];
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory, originalEnv, originalGlobals, listeners, adapter;
let metrics, correlation, storage;
const route = (load) => ({
  GET: async (...args) => (await load()).GET(...args),
  POST: async (...args) => (await load()).POST(...args),
});
const files = route(() => import("../../src/app/api/v1/files/route.js"));
const batches = route(() => import("../../src/app/api/v1/batches/route.js"));
const batchDetail = route(() => import("../../src/app/api/v1/batches/[id]/route.js"));
const fileContent = route(() => import("../../src/app/api/v1/files/[id]/content/route.js"));
const legacy = route(() => import("../../src/app/api/v1/completions/route.js"));
const gemini = route(() => import("../../src/app/api/v1beta/models/[...path]/route.js"));
let baseline;
const ownedBatchIds = [];

const chatBody = { model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "fixture" }], stream: false };
const geminiBody = { contents: [{ role: "user", parts: [{ text: "fixture" }] }] };
const post = (url, body, init = {}) => new Request(`https://gateway.test${url}`, {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body), ...init,
});
const context = (id) => ({ params: Promise.resolve({ id }) });
const geminiContext = (action = "generateContent", model = "gpt-4o-mini", providerId = "openai") => ({
  params: Promise.resolve({ path: [providerId, `${model}:${action}`] }),
});

function upstreamChat({ body, stream }) {
  const completion = {
    id: "chat-fixture", object: "chat.completion", created: 1, model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content: "provider reply" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
  const response = stream ? new Response([
    { id: completion.id, object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: { role: "assistant", content: "provider reply" }, finish_reason: null }] },
    { id: completion.id, object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: completion.usage },
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  }) : Response.json(completion);
  return { response, url: "https://api.openai.com/v1/chat/completions", headers: {}, transformedBody: body };
}

function providerFetch(input) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://api.openai.com" && url.pathname === "/v1/embeddings") {
    return Promise.resolve(Response.json({
      object: "list", model: "text-embedding-3-small",
      data: [{ object: "embedding", index: 0, embedding: [0.25, 0.5] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }));
  }
  if (url.origin === "https://generativelanguage.googleapis.com" && url.pathname.endsWith(":generateContent")) {
    return Promise.resolve(Response.json({
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [
        { inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "cGNt" } },
      ] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 },
    }));
  }
  throw new Error(`Unexpected fixture provider transport: ${url.origin}${url.pathname}`);
}

function snapshot() {
  const text = metrics.operationalMetricsText();
  const value = (name) => {
    const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
    expect(line, name).toBeDefined();
    return Number(line.slice(name.length + 1));
  };
  return {
    starts: value("durindoor_http_requests_total"),
    active: value("durindoor_http_active_requests"),
    completed: value('durindoor_http_requests_completed_total{outcome="completed"}'),
    cancelled: value('durindoor_http_requests_completed_total{outcome="cancelled"}'),
    errors: value('durindoor_http_requests_completed_total{outcome="http_error"}'),
    durations: value("durindoor_http_request_duration_seconds_count"),
  };
}

function expectDelta(expected) {
  const actual = snapshot();
  const delta = Object.fromEntries(Object.keys(actual).map((key) => [key, actual[key] - baseline[key]]));
  expect(delta).toEqual({ starts: 0, active: 0, completed: 0, cancelled: 0, errors: 0, durations: 0, ...expected });
}

beforeAll(async () => {
  originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  originalGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd1129-http-boundary-"));
  process.env.HOME = path.join(directory, "home");
  fs.mkdirSync(process.env.HOME, { mode: 0o700 });
  process.env.DATA_DIR = path.join(directory, "data");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  for (const name of globalNames) delete globalThis[name];
  vi.resetModules();
  vi.stubGlobal("fetch", provider.fetch.mockImplementation(providerFetch));
  const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
  const { createProviderConnection } = await import("@/lib/db/repos/connectionsRepo.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  await updateSettings({ requireApiKey: false, enableProxyTimeline: false });
  for (const providerId of ["openai", "gemini"]) {
    await createProviderConnection({
      provider: providerId, authType: "apikey", name: "metrics fixture", apiKey: "synthetic-fixture-only", isActive: true,
    });
  }
  metrics = await import("../../open-sse/services/operationalMetrics.js");
  correlation = await import("../../src/sse/utils/requestCorrelation.js");
  storage = await import("../../open-sse/services/localFilesBatches.js");
});

beforeEach(() => {
  provider.execute.mockReset().mockImplementation(upstreamChat);
  provider.fetch.mockClear();
  baseline = snapshot();
});

afterEach(() => {
  expect(snapshot().active).toBe(baseline.active);
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
    // These globals were created after the fixture snapshot. Clear their
    // session/stat eviction timers without touching the runner's deadlines.
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

describe("explicit public HTTP observations", () => {
  it("finishes an actual file GET auth denial used for implicit HEAD with its body unread", async () => {
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const counter = () => Number(metrics.operationalMetricsText().split("\n")
      .find((line) => line.startsWith('durindoor_client_admission_failures_total{reason="auth_missing"} ')).split(" ")[1]);
    const before = counter();
    await updateSettings({ requireApiKey: true });
    let response;
    try {
      response = await fileContent.GET(new Request("https://gateway.test/v1/files/file_000000000000000000000000/content", { method: "HEAD" }),
        context("file_000000000000000000000000"));
    } finally {
      await updateSettings({ requireApiKey: false });
    }
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.body).not.toBeNull();
    expect(response.bodyUsed).toBe(false);
    expect(counter()).toBe(before + 1);
    expectDelta({ starts: 1, errors: 1, durations: 1 });
    // Downstream HEAD suppression need not read or cancel this body. A later
    // disposal still cannot account for the same terminal response again.
    await response.body.cancel("fixture disposal after terminal HEAD");
    expect(counter()).toBe(before + 1);
    expectDelta({ starts: 1, errors: 1, durations: 1 });
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it.each(["/v1/chat/completions", "/v1/embeddings"])("counts batch HTTP operations without counting default-executor %s rows", async (endpoint) => {
    const body = endpoint.endsWith("embeddings") ? { model: "openai/text-embedding-3-small", input: "fixture" } : chatBody;
    const jsonl = ["first", "second"].map((custom_id) => JSON.stringify({ custom_id, method: "POST", url: endpoint, body })).join("\n") + "\n";
    const form = new FormData();
    form.set("purpose", "batch");
    form.set("file", new File([jsonl], "fixture.jsonl", { type: "application/jsonl" }));
    const uploaded = await files.POST(new Request("https://gateway.test/v1/files", { method: "POST", body: form }));
    expect(uploaded.status).toBe(201);
    const file = await uploaded.json();
    const response = await batches.POST(post("/v1/batches", { input_file_id: file.id, endpoint, completion_window: "24h" }));
    expect(response.status).toBe(200);
    const created = await response.json();
    ownedBatchIds.push(created.id);
    await storage._waitForBatch(created.id);
    expectDelta({ starts: 2, completed: 2, durations: 2 });

    const status = await batchDetail.GET(new Request(`https://gateway.test/v1/batches/${created.id}`), context(created.id));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: "completed", request_counts: { total: 2, completed: 2, failed: 0 } });
    const output = await storage.getBatchOutputText(created.id, "output", { ownerId: "local" });
    const rows = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.response.status_code)).toEqual([200, 200]);
    if (endpoint.endsWith("embeddings")) {
      expect(rows[0].response.body.data[0].embedding).toEqual([0.25, 0.5]);
      expect(provider.fetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/embeddings"))).toHaveLength(2);
    } else {
      expect(rows[0].response.body.choices[0].message.content).toBe("provider reply");
      expect(provider.execute).toHaveBeenCalledTimes(2);
    }
    expectDelta({ starts: 3, completed: 3, durations: 3 });
  });

  it("finishes a real file GET used for implicit HEAD without consuming its returned body", async () => {
    const file = await storage.uploadFile({ filename: "head.txt", bytes: "unread", purpose: "batch" }, { ownerId: "local" });
    const response = await fileContent.GET(new Request(`https://gateway.test/v1/files/${file.id}/content`, { method: "HEAD" }), context(file.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.body).not.toBeNull();
    expect(response.bodyUsed).toBe(false);
    expectDelta({ starts: 1, completed: 1, durations: 1 });
    // The framework discards this body; deliberately never read/cancel/abort it.
  });

  it("observes the final legacy response after real Request derivation and shared correlation", async () => {
    const request = post("/v1/completions", { model: chatBody.model, prompt: "fixture", stream: false });
    const response = await legacy.POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(correlation.getRequestId(request));
    expect(provider.execute).toHaveBeenCalledOnce();
    expectDelta({ starts: 1, active: 1 });
    expect(await response.json()).toMatchObject({ object: "text_completion", choices: [{ text: "provider reply" }] });
    expectDelta({ starts: 1, completed: 1, durations: 1 });
  });

  it.each(["cancel", "EOF"])("observes Gemini's final JSON body through %s after the bridge consumes internal chat JSON", async (terminal) => {
    const response = await gemini.POST(post("/v1beta/models/openai/gpt-4o-mini:generateContent", geminiBody), geminiContext());
    expect(response.status).toBe(200);
    expect(provider.execute).toHaveBeenCalledOnce();
    expect(response.bodyUsed).toBe(false);
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "cancel") {
      await response.body.cancel("client cancelled final Gemini JSON");
      expectDelta({ starts: 1, cancelled: 1, durations: 1 });
    } else {
      expect((await response.json()).candidates[0].content.parts).toContainEqual({ text: "provider reply" });
      expectDelta({ starts: 1, completed: 1, durations: 1 });
    }
  });

  it.each(["cancel", "EOF"])("observes Gemini's final translated SSE through %s", async (terminal) => {
    const response = await gemini.POST(post("/v1beta/models/openai/gpt-4o-mini:streamGenerateContent", geminiBody), geminiContext("streamGenerateContent"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expectDelta({ starts: 1, active: 1 });
    if (terminal === "cancel") {
      await response.body.cancel("client cancelled final Gemini SSE");
      expectDelta({ starts: 1, cancelled: 1, durations: 1 });
    } else {
      expect(await response.text()).toContain('"text":"provider reply"');
      expectDelta({ starts: 1, completed: 1, durations: 1 });
    }
  });

  it("observes an outer Gemini abort without adding signal inheritance to its derived chat Request", async () => {
    const abort = new AbortController();
    let entered, release, providerSignal;
    const dispatched = new Promise((resolve) => { entered = resolve; });
    const resumed = new Promise((resolve) => { release = resolve; });
    provider.execute.mockImplementation(async (args) => {
      providerSignal = args.signal;
      entered();
      await resumed;
      return upstreamChat(args);
    });
    const pending = gemini.POST(post("/v1beta/models/openai/gpt-4o-mini:generateContent", geminiBody, { signal: abort.signal }), geminiContext());
    await dispatched;
    abort.abort("outer client abort");
    const inheritedAbort = providerSignal.aborted;
    release();
    const response = await pending;
    expect(inheritedAbort).toBe(false);
    expect(response.status).toBe(200);
    expectDelta({ starts: 1, cancelled: 1, durations: 1 });
    expect((await response.json()).candidates[0].content.parts).toContainEqual({ text: "provider reply" });
    expectDelta({ starts: 1, cancelled: 1, durations: 1 });
  });

  it("accounts Gemini invalid JSON before dispatch", async () => {
    const response = await gemini.POST(new Request("https://gateway.test/v1beta/models/openai/gpt-4o-mini:generateContent", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }), geminiContext());
    expect(response.status).toBe(500);
    expect(provider.execute).not.toHaveBeenCalled();
    expectDelta({ starts: 1, active: 1 });
    expect((await response.json()).error.code).toBe(500);
    expectDelta({ starts: 1, errors: 1, durations: 1 });
  });

  it("accounts native Gemini TTS without routing through handleChat", async () => {
    const response = await gemini.POST(post("/v1beta/models/gemini/gemini-2.5-flash-preview-tts:generateContent", {
      ...geminiBody, generationConfig: { responseModalities: ["AUDIO"], speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      } },
    }), geminiContext("generateContent", "gemini-2.5-flash-preview-tts", "gemini"));
    expect(response.status).toBe(200);
    expect(provider.execute).not.toHaveBeenCalled();
    expect(provider.fetch.mock.calls.some(([url]) => String(url).includes("generativelanguage.googleapis.com"))).toBe(true);
    expectDelta({ starts: 1, active: 1 });
    expect((await response.json()).candidates[0].content.parts[0].inlineData.data).toBe("cGNt");
    expectDelta({ starts: 1, completed: 1, durations: 1 });
  });

  it("keeps shared correlation-only calls unobserved while distinct explicit public calls count", async () => {
    const shared = correlation.withRequestCorrelation(() => new Response("shared"));
    expect(await (await shared(new Request("https://gateway.test/v1/chat/completions"))).text()).toBe("shared");
    expectDelta({});
    const inner = correlation.withHttpRequestCorrelation(() => new Response("independent"));
    const outer = correlation.withHttpRequestCorrelation(async () => new Response(await (await inner(new Request("https://gateway.test/v1/chat/completions"))).text()));
    expect(await (await outer(new Request("https://gateway.test/v1/chat/completions"))).text()).toBe("independent");
    expectDelta({ starts: 2, completed: 2, durations: 2 });
  });
});
