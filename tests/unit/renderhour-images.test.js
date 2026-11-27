// RenderHour images, staged. Closed mocks only: every request is answered below,
// an unexpected URL fails the test, and every key is synthetic. Passing here says
// nothing about the live service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staged = vi.hoisted(() => ({ adapter: null }));

// While staged, the adapter map does not know this provider, so the core tests substitute that one lookup.
vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageAdapter: (id) => (id === "renderhour" && staged.adapter ? staged.adapter : actual.getImageAdapter(id)),
  };
});

import provider, { RENDERHOUR_GENERATIONS_URL, RENDERHOUR_IMAGE_MODEL_IDS } from "../../open-sse/providers/private/renderhour.js";
import renderHourAdapter, { createRenderHourImageAdapter } from "../../open-sse/handlers/imageProviders/renderhour.js";
import * as job from "../../open-sse/services/renderhour/job.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";

const KEY_A = "rh_synthetic_account_a";
const KEY_B = "rh_synthetic_account_b";
const FILE_A = "https://renderhour.com/files/a1";
const FILE_B = "https://renderhour.com/files/a2";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const png = (url = FILE_A) => ({ asset_id: "asset-1", content_type: "image/png", url });
const queued = (id = "job-1") => ({ id, status: "queued", outputs: [] });
const running = (id = "job-1") => ({ id, status: "running", outputs: [] });
const done = (outputs = [png()], id = "job-1") => ({ id, status: "succeeded", outputs });

const originalFetch = global.fetch;
let calls;

// Answers requests in order. A step is a Response or a function of the request.
function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}

// A virtual clock: waits are recorded and advance time without sleeping.
function clock() {
  let time = 1_000_000;
  const waits = [];
  return {
    waits,
    now: () => time,
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
      time += ms;
    },
  };
}

function useAdapter(polling = {}) {
  const virtual = clock();
  staged.adapter = createRenderHourImageAdapter({ wait: virtual.wait, now: virtual.now, ...polling });
  return virtual;
}

function run({ body = {}, key = KEY_A, credentials = { apiKey: key }, model = "z-image", ...options } = {}) {
  return handleImageGenerationCore({
    body: { prompt: "a fox in the snow", ...body },
    modelInfo: { provider: "renderhour", model },
    credentials,
    log: null,
    ...options,
  });
}

function expectAccepted(result) {
  expect(result.success).toBe(false);
  expect(result.acceptedJob).toMatchObject({
    modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" },
  });
}

const submits = () => calls.filter((call) => call.init.method === "POST");

beforeEach(() => {
  calls = [];
  useAdapter();
});
afterEach(() => {
  global.fetch = originalFetch;
  staged.adapter = null;
});

describe("renderhour staging", () => {
  it("declares an image-only API-key identity with no chat transport", () => {
    expect(provider).toMatchObject({ id: "renderhour", category: "apikey", authType: "apikey", transport: null, serviceKinds: ["image"] });
    expect(provider.models.map((model) => model.id)).toEqual(RENDERHOUR_IMAGE_MODEL_IDS);
    expect(provider.models).toHaveLength(11);
    expect(new Set(provider.models.map((model) => model.kind))).toEqual(new Set(["image"]));
    for (const field of ["oauth", "authModes", "hasOAuth", "ttsConfig", "videoConfig", "passthroughModels"]) {
      expect(provider).not.toHaveProperty(field);
    }
    expect(provider.imageConfig.baseUrl).toBe("https://renderhour.com/v1/generations");
  });

  it("is not reachable through the registry, the adapter map or a chat executor", async () => {
    const actual = await vi.importActual("../../open-sse/handlers/imageProviders/index.js");
    expect(actual.getImageAdapter("renderhour")).toBeNull();
    expect(REGISTRY.some((entry) => entry.id === "renderhour")).toBe(false);
    expect(hasSpecializedExecutor("renderhour")).toBe(false);
  });

  it("ships the pinned poll bounds", () => {
    expect(renderHourAdapter.async).toBe(true);
    expect(job.RENDERHOUR_POLL_INTERVAL_MS).toBe(2_000);
    expect(job.RENDERHOUR_POLL_TIMEOUT_MS).toBe(300_000);
    expect(job.RENDERHOUR_MAX_POLL_RETRIES).toBe(5);
    expect(job.RENDERHOUR_MAX_RETRY_DELAY_MS).toBe(30_000);
  });
});

describe("renderhour success", () => {
  it("submits once, polls to success and returns image URLs with returned-image usage", async () => {
    const virtual = useAdapter();
    const onRequestSuccess = vi.fn();
    serve(json(queued(), 201), json(running()), json(done([png(FILE_A), { ...png(FILE_B), content_type: "image/webp" }])));

    const result = await run({ body: { n: 2, size: "1792x1024", model: "ignored" }, onRequestSuccess });

    expect(result.success).toBe(true);
    expect((await result.response.json()).data).toEqual([{ url: FILE_A }, { url: FILE_B }]);
    expect(calls.map((call) => call.url)).toEqual([
      RENDERHOUR_GENERATIONS_URL, `${RENDERHOUR_GENERATIONS_URL}/job-1`, `${RENDERHOUR_GENERATIONS_URL}/job-1`,
    ]);
    const [submit, poll] = calls;
    expect(submit.init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(submit.init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(submit.init.body)).toEqual({ model: "z-image", prompt: "a fox in the snow", count: 2, aspect_ratio: "16:9" });
    expect(poll.init).toMatchObject({ method: "GET", redirect: "error" });
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, Accept: "application/json" });
    expect(poll.init.body).toBeUndefined();
    expect(virtual.waits).toEqual([2_000, 2_000]);
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "image", tokens: {}, nativeUnits: { images: 2 }, cost: null, costStatus: "unknown",
    });
    expect(result.acceptedJob).toBeUndefined();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });

  it("accepts a submit that already succeeded, without polling", async () => {
    serve(json(done(), 201));
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.accounting.nativeUnits).toEqual({ images: 1 });
    expect(calls).toHaveLength(1);
  });

  it("counts returned images, not requested ones, and ignores undocumented receipts", async () => {
    serve(json(queued()), json({ ...done(), usage: { cost_usd: 9, total_tokens: 5 } }));
    const result = await run({ body: { n: 4 } });
    expect(result.accounting).toMatchObject({ nativeUnits: { images: 1 }, tokens: {}, cost: null, costStatus: "unknown" });
  });

  it("uses a new idempotency key for each request", async () => {
    serve(json(done()), json(done()));
    await run();
    await run();
    expect(calls[0].init.headers["Idempotency-Key"]).not.toBe(calls[1].init.headers["Idempotency-Key"]);
  });

  it.each([
    [{ size: "1024x1024" }, { count: 1, aspect_ratio: "1:1" }],
    [{ size: "1024x1536", n: 9 }, { count: 4, aspect_ratio: "3:4" }],
    [{ size: "auto", n: 0 }, { count: 1 }],
    [{ n: "3" }, { count: 1 }],
    [{ aspect_ratio: "4:5", size: "1x1" }, { count: 1, aspect_ratio: "4:5" }],
    [{ quality: "hd" }, { count: 1 }],
    [{ resolution: "2k", config: { quality: "high", audio: true, duration_s: 8 } }, { count: 1, config: { resolution: "2k", quality: "high" } }],
  ])("maps %j onto the submit body", async (body, expected) => {
    serve(json(done()));
    await run({ body });
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: "z-image", prompt: "a fox in the snow", ...expected });
  });
});

describe("renderhour refusals before dispatch", () => {
  it.each([
    ["no credential", {}],
    ["a subscription OAuth token", { accessToken: "rh_synthetic_oauth" }],
    ["a key without the rh_ prefix", { apiKey: "sk-synthetic" }],
    ["a key with a line break", { apiKey: "rh_synthetic\r\nX-Extra: 1" }],
  ])("refuses %s with 401", async (_name, credentials) => {
    serve();
    const result = await run({ credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.error).not.toContain("synthetic");
    expect(calls).toHaveLength(0);
  });

  it.each(["seedance-2.5", "eleven-v4", "gpt-6-sol", "../uploads"])("refuses the non-image model %s", async (model) => {
    serve();
    expect(await run({ model })).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it.each(["image", "images", "image_url", "image_urls", "reference_images", "mask"])(
    "refuses reference input in %s instead of dropping it",
    async (field) => {
      serve();
      const result = await run({ body: { [field]: "https://example.com/reference.png" } });
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(calls).toHaveLength(0);
    }
  );
});

describe("renderhour submit errors", () => {
  it.each([401, 403, 429])("keeps submit status %i, sends one request and records no accepted job", async (status) => {
    const onRequestSuccess = vi.fn();
    serve(json({ error: { code: "refused", message: "synthetic refusal" } }, status));
    const result = await run({ onRequestSuccess });
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.accounting).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RENDERHOUR_GENERATIONS_URL);
  });
});

describe("renderhour poll errors", () => {
  it.each([401, 403])("passes poll status %i on as an accepted job without resubmitting", async (status) => {
    serve(json(queued()), json({ error: { message: `refused ${KEY_A}` } }, status));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(status);
    expect(result.error).not.toContain(KEY_A);
    expect(calls).toHaveLength(2);
    expect(submits()).toHaveLength(1);
  });

  it("backs off on 429 and 503, honoring Retry-After, then succeeds", async () => {
    const virtual = useAdapter();
    serve(json(queued()), json({}, 429, { "retry-after": "7" }), json({}, 503), json(running()), json(done()));
    const result = await run();
    expect(result.success).toBe(true);
    expect(virtual.waits).toEqual([2_000, 7_000, 4_000, 2_000]);
    expect(submits()).toHaveLength(1);
  });

  it("caps a long Retry-After and stops after five retries", async () => {
    const virtual = useAdapter();
    serve(json(queued()), ...Array.from({ length: 6 }, () => json({}, 429, { "retry-after": "3600" })));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(429);
    expect(virtual.waits).toEqual([2_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
    expect(calls).toHaveLength(7);
  });

  it("reports the rate limit when the next retry would pass the deadline", async () => {
    useAdapter({ timeoutMs: 5_000 });
    serve(json(queued()), json({}, 429, { "retry-after": "20" }));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("resets the retry budget after a good poll", async () => {
    const busy = () => json({}, 503);
    serve(json(queued()), busy(), busy(), busy(), json(running()), busy(), busy(), busy(), json(done()));
    expect((await run()).success).toBe(true);
  });

  it.each([404, 500])("treats poll status %i as a lost observation at once", async (status) => {
    serve(json(queued()), json({}, status));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(502);
    expect(calls).toHaveLength(2);
  });

  it("does not repeat transport or redirect error text", async () => {
    serve(json(queued()), () => { throw new TypeError(`redirect refused for Bearer ${KEY_A}`); });
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(502);
    expect(result.error).toBe("RenderHour status check failed");
  });
});

describe("renderhour failed jobs", () => {
  it.each([
    ["moderation", 422], ["invalid_input", 422], ["timeout", 504], ["expired", 504],
  ])("maps failure reason %s to %i", async (reason, status) => {
    const onRequestSuccess = vi.fn();
    serve(json(queued()), json({ id: "job-1", status: "failed", failure_reason: reason, outputs: [] }));
    const result = await run({ onRequestSuccess });
    expect(result).toMatchObject({ success: false, status, error: `RenderHour image job failed: ${reason}` });
    expect(result.acceptedJob).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it.each([KEY_A, "supplier exploded at /home/x", undefined, { nested: KEY_A }])(
    "never repeats the unrecognized reason %j",
    async (reason) => {
      serve(json({ id: "job-1", status: "failed", failure_reason: reason }));
      expect(await run()).toMatchObject({ success: false, status: 502, error: "RenderHour image job failed: unknown reason" });
      expect(calls).toHaveLength(1);
    }
  );
});

describe("renderhour timeout", () => {
  it("stops polling at the deadline and records an accepted job", async () => {
    const virtual = useAdapter({ timeoutMs: 10_000 });
    serve(json(queued()), ...Array.from({ length: 5 }, () => () => json(running())));
    const result = await run();
    expectAccepted(result);
    expect(result).toMatchObject({ status: 504, error: "RenderHour image job did not finish in time" });
    expect(virtual.waits).toEqual([2_000, 2_000, 2_000, 2_000, 2_000]);
    expect(calls).toHaveLength(6);
  });

  it("bounds a status request that never answers", async () => {
    useAdapter({ requestTimeoutMs: 20 });
    serve(json(queued()), (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const result = await run();
    expectAccepted(result);
    expect(result).toMatchObject({ status: 504, error: "RenderHour status check timed out" });
  });

  it.each([["submit", []], ["status", [json(queued())]]])("bounds a %s body that never ends", async (_name, before) => {
    useAdapter({ requestTimeoutMs: 20 });
    serve(...before, new Response(new ReadableStream({ start() {} })));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(502);
  });
});

describe("renderhour cancellation", () => {
  function expectAbort(result, accepted) {
    expect(result).toMatchObject({ success: false, status: 499 });
    if (accepted) expectAccepted(result);
    else expect(result.acceptedJob).toBeUndefined();
  }

  it("sends nothing further when cancelled during the real poll wait", async () => {
    staged.adapter = createRenderHourImageAdapter({ pollIntervalMs: 60_000 });
    const controller = new AbortController();
    serve(() => {
      setTimeout(() => controller.abort(), 10);
      return json(queued());
    });
    expectAbort(await run({ signal: controller.signal }), true);
    expect(calls).toHaveLength(1);
  });

  it("aborts an in-flight status request", async () => {
    const controller = new AbortController();
    serve(json(queued()), (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort();
    }));
    expectAbort(await run({ signal: controller.signal }), true);
    expect(calls).toHaveLength(2);
  });

  it("discards a success that arrives after cancellation", async () => {
    const controller = new AbortController();
    const onRequestSuccess = vi.fn();
    serve(json(queued()), () => {
      controller.abort(new Error("client left"));
      return json(done());
    });
    expectAbort(await run({ signal: controller.signal, onRequestSuccess }), true);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("aborts a stalled status body", async () => {
    const controller = new AbortController();
    serve(json(queued()), () => {
      setTimeout(() => controller.abort(), 10);
      return new Response(new ReadableStream({ start() {} }));
    });
    expectAbort(await run({ signal: controller.signal }), true);
  });

  it("aborts an in-flight submit at the transport and keeps the possibly accepted job", async () => {
    const controller = new AbortController();
    const reason = new Error("client left");
    let seen;
    serve((_url, init) => new Promise((_, reject) => {
      seen = { aborted: init.signal.aborted };
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort(reason);
    }));
    const result = await run({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    // The fetch signal is composed with the submit deadline, live until the caller aborts,
    // and then aborted with the caller's own reason.
    expect(seen).toEqual({ aborted: false });
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls[0].init.signal.reason).toBe(reason);
    expect(result.acceptedJob).toMatchObject({
      modality: "image", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
    });
    expect(calls).toHaveLength(1);
  });

  it("sends nothing and claims no job when cancelled before the submit", async () => {
    const controller = new AbortController();
    controller.abort();
    serve();
    expectAbort(await run({ signal: controller.signal }), false);
    expect(calls).toHaveLength(0);
  });
});

describe("renderhour malformed results", () => {
  async function expectUnknown(...steps) {
    const onRequestSuccess = vi.fn();
    const expected = steps.length;
    serve(...steps);
    const result = await run({ onRequestSuccess });
    expectAccepted(result);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/^RenderHour /);
    expect(result.error).not.toContain("synthetic");
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(calls).toHaveLength(expected);
  }

  it.each([
    ["is not JSON", `<html>${KEY_A}`],
    ["is empty", ""],
    ["is an array", "[]"],
    ["is oversized", JSON.stringify({ ...queued(), padding: "x".repeat(70_000) })],
    ["has no id", JSON.stringify({ status: "queued" })],
    ["has a path in its id", JSON.stringify(queued("../uploads"))],
    ["has a URL as its id", JSON.stringify(queued("https://example.com/job"))],
    ["has no status", JSON.stringify({ id: "job-1" })],
    ["has an unknown status", JSON.stringify({ id: "job-1", status: KEY_A })],
  ])("treats a 2xx submit that %s as accepted, and never polls", async (_name, body) => {
    await expectUnknown(new Response(body, { status: 201 }));
  });

  it.each([
    ["unreadable", new Response("<html>")],
    ["about another job", json(done([png()], "job-2"))],
    ["of an unknown status", json({ id: "job-1", status: "paused" })],
  ])("stops on a status response that is %s", async (_name, response) => {
    await expectUnknown(json(queued()), response);
  });

  it.each([
    ["no outputs field", undefined],
    ["an empty list", []],
    ["a non-list", { url: FILE_A }],
    ["a null item", [null]],
    ["a video", [{ content_type: "video/mp4", url: FILE_A }]],
    ["audio", [{ content_type: "audio/mpeg", url: FILE_A }]],
    ["no content type", [{ url: FILE_A }]],
    ["no URL", [{ content_type: "image/png" }]],
    ["a relative URL", [png("/files/a1")]],
    ["a plain HTTP URL", [png("http://renderhour.com/files/a1")]],
    ["a data URL", [png("data:image/png;base64,AAAA")]],
    ["URL credentials", [png("https://user:synthetic@renderhour.com/files/a1")]],
    ["an overlong URL", [png(`${FILE_A}?q=${"x".repeat(5_000)}`)]],
    ["more files than requested", [png(FILE_A), png(FILE_B)]],
  ])("rejects a success with %s", async (_name, outputs) => {
    await expectUnknown(json(queued()), json({ id: "job-1", status: "succeeded", outputs }));
  });

  it("rejects the whole result when one of several files is unusable", async () => {
    serve(json(done([png(), { content_type: "video/mp4", url: FILE_B }])));
    expectAccepted(await run({ body: { n: 2 } }));
  });
});

describe("renderhour account isolation", () => {
  const accounts = {
    [KEY_A]: { id: "job-a", file: FILE_A },
    [KEY_B]: { id: "job-b", file: FILE_B },
  };
  const credentialsFor = (key, port) => ({
    apiKey: key,
    providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: `http://127.0.0.1:${port}` },
  });

  // Each key only ever sees its own job; any crossed key, id or order fails.
  function serveAccounts(override = () => null) {
    const polls = { "job-a": 0, "job-b": 0 };
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      const key = init.headers.Authorization.replace("Bearer ", "");
      const account = accounts[key];
      if (!account) throw new Error("Unknown key");
      const forced = override(key, init);
      if (forced) return forced;
      if (init.method === "POST") return json(queued(account.id), 201);
      if (String(url) !== `${RENDERHOUR_GENERATIONS_URL}/${account.id}`) return json({}, 404);
      polls[account.id] += 1;
      return json(polls[account.id] < (key === KEY_A ? 3 : 2) ? running(account.id) : done([png(account.file)], account.id));
    });
  }

  it("keeps concurrent keys, job ids, proxies and results apart", async () => {
    staged.adapter = createRenderHourImageAdapter({ pollIntervalMs: 1 });
    serveAccounts();
    const credentials = { [KEY_A]: credentialsFor(KEY_A, 9001), [KEY_B]: credentialsFor(KEY_B, 9002) };
    const [a, b] = await Promise.all([run({ credentials: credentials[KEY_A] }), run({ credentials: credentials[KEY_B] })]);

    expect((await a.response.json()).data).toEqual([{ url: FILE_A }]);
    expect((await b.response.json()).data).toEqual([{ url: FILE_B }]);
    expect(a.accounting.nativeUnits).toEqual({ images: 1 });
    expect(b.accounting.nativeUnits).toEqual({ images: 1 });
    expect(a.accounting).not.toBe(b.accounting);
    expect(calls).toHaveLength(7);
    for (const { url, init } of calls.filter((call) => call.init.method === "GET")) {
      const key = url.endsWith("/job-a") ? KEY_A : KEY_B;
      expect(init.headers.Authorization).toBe(`Bearer ${key}`);
      expect(init.proxyOptions).toEqual(resolveCredentialProxyOptions(credentials[key]));
    }
    expect(resolveCredentialProxyOptions(credentials[KEY_A])).not.toEqual(resolveCredentialProxyOptions(credentials[KEY_B]));
  });

  it.each([401, 429])("does not let one account's submit %i affect the other", async (status) => {
    staged.adapter = createRenderHourImageAdapter({ pollIntervalMs: 1 });
    serveAccounts((key, init) => (key === KEY_A && init.method === "POST" ? json({}, status) : null));
    const [a, b] = await Promise.all([run({ key: KEY_A }), run({ key: KEY_B })]);
    expect(a).toMatchObject({ success: false, status });
    expect(b.success).toBe(true);
    expect((await b.response.json()).data).toEqual([{ url: FILE_B }]);
  });

  it("does not let one account's cancellation stop the other", async () => {
    staged.adapter = createRenderHourImageAdapter({ pollIntervalMs: 1 });
    const controller = new AbortController();
    serveAccounts((key, init) => {
      if (key === KEY_A && init.method === "GET") controller.abort();
      return null;
    });
    const [a, b] = await Promise.all([run({ key: KEY_A, signal: controller.signal }), run({ key: KEY_B })]);
    expect(a.status).toBe(499);
    expect(b.success).toBe(true);
  });
});
