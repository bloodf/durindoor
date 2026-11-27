import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #2647 review: a client cancel after the provider's 2xx headers must not be
// recorded from the status line alone. A 200 can carry an error envelope, an
// empty body or an unread receipt, so only usage actually read is evidence.
// Real handlers, cores, adapters, policy and SQLite; only credentials, model
// parsing and the provider HTTP transport are local stubs. No provider is called.

const state = vi.hoisted(() => ({ credentials: vi.fn(), markUnavailable: vi.fn(), combo: null }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "job-secret", auth: { ok: true, apiKeyId: "job-key" } }),
  hasValidCliToken: async () => false,
  extractApiKey: () => "job-secret",
  getProviderCredentialsWithQuotaPreflight: (...args) => state.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: (...args) => state.markUnavailable(...args),
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
  getComboModels: async () => state.combo,
  getComboCanonicalName: async () => (state.combo ? "image-combo" : null),
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/handlers/imageProviders/_base.js", async (original) => ({ ...(await original()), POLL_INTERVAL_MS: 1 }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let database; let handleImage; let policy;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const send = (controller = new AbortController()) => handleImage(new Request("http://localhost/v1/images/generations", {
  method: "POST", signal: controller.signal, body: JSON.stringify({ model: "runwayml/gen4_image", prompt: "fixture" }),
}));
const expectAcceptedUnknown = (row, connectionId = "account-a") => {
  expect(row).toMatchObject({ provider: "runwayml", model: "gen4_image", connectionId, apiKey: null, apiKeyId: "job-key", endpoint: "/v1/images/generations", status: "accepted", cost: null, promptTokens: 0, completionTokens: 0 });
  expect(JSON.parse(row.meta)).toMatchObject({ modality: "image", costStatus: "unknown", costSource: "accepted-job", jobState: "accepted", nativeUnits: {} });
};

// Transforming the handler, DB and policy graph is the slow part. Warm it once so
// beforeEach keeps the default hook timeout and a real hang still fails.
beforeAll(async () => {
  const before = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  const env = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  const warm = fs.mkdtempSync(path.join(os.tmpdir(), "image-cancel-evidence-warm-"));
  process.env.DATA_DIR = warm;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  try {
    await import("@/lib/db/index.js");
    await import("@/sse/handlers/imageGeneration.js");
    await import("@/sse/services/apiKeyPolicy.js");
    await import("@/lib/db/repos/monitoringUsageRepo.js");
  } finally {
    await global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    for (const signal of signals) for (const listener of process.listeners(signal)) if (!before.get(signal).has(listener)) process.removeListener(signal, listener);
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(warm, { recursive: true, force: true });
  }
}, 60_000);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "TMPDIR", "TMP", "TEMP", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-cancel-evidence-"));
  for (const name of ["home", "data", "tmp"]) fs.mkdirSync(path.join(directory, name));
  process.env.HOME = path.join(directory, "home");
  process.env.DATA_DIR = path.join(directory, "data");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = path.join(directory, "tmp");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  state.credentials.mockReset().mockResolvedValue({ connectionId: "account-a", apiKey: "provider-secret", connectionName: "A" });
  state.markUnavailable.mockReset().mockResolvedValue({ shouldFallback: false });
  state.combo = null;
  vi.stubGlobal("fetch", vi.fn());
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["job-key", "job-secret", "Accepted jobs", JSON.stringify({ maxCostUsd: 0.5 }), new Date().toISOString()]);
  ({ handleImageGeneration: handleImage } = await import("@/sse/handlers/imageGeneration.js"));
  policy = await import("@/sse/services/apiKeyPolicy.js");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});


const enc = (text) => new TextEncoder().encode(text);
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const USAGE = { input_tokens: 9, output_tokens: 4, total_tokens: 13 };

/**
 * A 2xx whose body sends `chunks`, then stalls until the request signal aborts,
 * erroring the body like fetch does. The client leaves once headers are out.
 */
const stalled = (chunks, client, contentType = "application/json", status = 200) => async (_url, { signal }) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(enc(chunk));
    signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    setTimeout(() => client.abort(), 5);
  },
}), { status, headers: { "Content-Type": contentType } });

const generate = (controller, model = "openai/gpt-image-1", headers = {}) => handleImage(new Request("http://localhost/v1/images/generations", {
  method: "POST", signal: controller?.signal, headers, body: JSON.stringify({ model, prompt: "fixture" }),
}));
const edit = async (controller, model = "openai/gpt-image-1") => {
  const { handleImageEdit } = await import("@/sse/handlers/imageEdit.js");
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", "fixture");
  form.set("image", new Blob(["img"], { type: "image/png" }), "a.png");
  return handleImageEdit(new Request("http://localhost/v1/images/edits", { method: "POST", signal: controller?.signal, body: form }));
};
const expectNothingConsumed = async () => {
  expect(rows()).toHaveLength(0);
  expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 0, totalCost: 0, unknownCostRequests: 0 });
};
const expectNoAccountSideEffects = () => {
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state.credentials).toHaveBeenCalledTimes(1);
  expect(state.markUnavailable).not.toHaveBeenCalled();
};

describe("header-only cancels record nothing", () => {
  const bodies = {
    "a 200 error envelope": '{"error":{"message":"content policy","type":"invalid_request_error"',
    "an image body without its usage": '{"created":1,"data":[{"b64_json":"aGk="}],"usage":{"input_',
    "an empty body": "",
  };

  for (const [name, chunk] of Object.entries(bodies)) {
    it(`generation: ${name} interrupted before EOF consumes no quota and no counters`, async () => {
      const controller = new AbortController();
      fetch.mockImplementationOnce(stalled(chunk ? [chunk] : [], controller));
      const response = await generate(controller);
      expect(response.status).toBe(499);
      expectNoAccountSideEffects();
      await expectNothingConsumed();
    });

    it(`edit: ${name} interrupted before EOF returns 499 and consumes nothing`, async () => {
      const controller = new AbortController();
      fetch.mockImplementationOnce(stalled(chunk ? [chunk] : [], controller));
      const response = await edit(controller);
      expect(response.status).toBe(499);
      expectNoAccountSideEffects();
      await expectNothingConsumed();
    });
  }

  it("does not let a native per-image tariff or the budget see a header-only cancel", async () => {
    const { updatePricing } = await import("@/lib/db/repos/pricingRepo.js");
    await updatePricing({ openai: { "gpt-image-1": { native: { unit: "image", rate: 0.5 } } } });
    const controller = new AbortController();
    fetch.mockImplementationOnce(stalled(['{"created":1,"data":[{"b64_json":"aGk="}]'], controller));
    expect((await generate(controller)).status).toBe(499);
    await expectNothingConsumed();
    // The 0.5 USD budget still admits the next request: nothing was consumed.
    fetch.mockResolvedValueOnce(json({ created: 1, data: [{ b64_json: "aGk=" }] }));
    expect((await generate()).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "ok" });
  });

  it("records nothing when the client cancels before the provider answers", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce(async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      setTimeout(() => controller.abort(), 5);
    }));
    expect((await generate(controller)).status).toBe(499);
    expectNoAccountSideEffects();
    await expectNothingConsumed();
  });

  it("does not move a combo to its next member after a header-only cancel", async () => {
    state.combo = ["openai/gpt-image-1", "openai/dall-e-3"];
    const controller = new AbortController();
    fetch.mockImplementationOnce(stalled(['{"error":{"message":"x"'], controller));
    expect((await generate(controller, "image-combo")).status).toBe(499);
    expectNoAccountSideEffects();
    await expectNothingConsumed();
  });

  it("still records a completed body that turns out to be an error envelope as nothing", async () => {
    fetch.mockResolvedValueOnce(json({ error: { message: "content policy" } }));
    const response = await generate();
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expectNothingConsumed();
  });
});

describe("cancels after actual receipt evidence", () => {
  beforeEach(() => {
    state.credentials.mockResolvedValue({ connectionId: "account-a", accessToken: "provider-secret", connectionName: "A" });
  });

  it("keeps a usage receipt read from a buffered Codex stream before the cancel, with no units invented", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce(stalled([
      sse("response.in_progress", { response: { status: "in_progress", usage: USAGE } }),
      sse("response.output_item.done", { item: { type: "image_generation_call", result: "aGk=" } }),
    ], controller, "text/event-stream"));
    expect((await generate(controller, "codex/gpt-5.4-image")).status).toBe(499);
    expectNoAccountSideEffects();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ provider: "codex", status: "cancelled", cost: null, promptTokens: 9, completionTokens: 4, connectionId: "account-a", apiKeyId: "job-key" });
    const meta = JSON.parse(rows()[0].meta);
    expect(meta).toMatchObject({ costStatus: "unknown", costSource: "client-cancelled", clientCancelled: "after-upstream-headers", nativeUnits: {} });
    expect(JSON.stringify(meta)).not.toContain("provider-secret");
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 1, totalCost: 0, unknownCostRequests: 1 });
  });

  it("records nothing for a Codex stream cancelled before any receipt", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce(stalled([sse("response.created", { response: { status: "in_progress" } })], controller, "text/event-stream"));
    expect((await generate(controller, "codex/gpt-5.4-image")).status).toBe(499);
    expectNoAccountSideEffects();
    await expectNothingConsumed();
  });

  it("keeps a receipt read from a client stream the caller cancels, and records nothing without one", async () => {
    for (const [chunk, expected] of [
      [sse("response.in_progress", { response: { status: "in_progress", usage: USAGE } }), 1],
      // No receipt: the row count stays at the one above.
      [sse("response.created", { response: { status: "in_progress" } }), 1],
    ]) {
      fetch.mockImplementationOnce(async (_url, { signal }) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(enc(chunk));
          signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      const response = await generate(undefined, "codex/gpt-5.4-image", { accept: "text/event-stream" });
      expect(response.status).toBe(200);
      const reader = response.body.getReader();
      await reader.read();
      await reader.cancel("client left");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rows()).toHaveLength(expected);
    }
    expect(rows()[0]).toMatchObject({ status: "cancelled", promptTokens: 9, completionTokens: 4 });
    expect(state.markUnavailable).not.toHaveBeenCalled();
  });
});

describe("accepted async jobs are unchanged", () => {
  it("still records an accepted job the client abandons during polling", async () => {
    const controller = new AbortController();
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    const response = await generate(controller, "runwayml/gen4_image");
    expect(response.status).toBe(499);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "accepted", cost: null });
    expect(JSON.parse(rows()[0].meta)).toMatchObject({ costSource: "accepted-job", nativeUnits: {} });
  });
});
