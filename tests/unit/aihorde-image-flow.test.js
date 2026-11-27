// #2034 staged AI Horde native image flow against closed mock transports. No
// Horde, R2 or other host is contacted (download URLs are public IP literals,
// so no DNS lookup runs). Passing proves our protocol handling only, not live
// AI Horde acceptance.
import { describe, expect, it } from "vitest";
import { createAiHordeImageAdapter, mapHordeImageRequest } from "../../open-sse/handlers/imageProviders/aihorde.js";
import { AI_HORDE_CLIENT_AGENT, HordeImageCatalog } from "../../open-sse/services/aihordeImageCatalog.js";

const KEY_A = "hordekey-account-a-111111";
const KEY_B = "hordekey-account-b-222222";
const JOB = "0a1b2c3d-4e5f-4789-9abc-def012345678";
const IMG_URL = "https://1.1.1.1/r2/result.webp?X-Amz-Signature=SIGNEDSECRET";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(20, 2)]);

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });

async function readyCatalog(rows = [{ name: "stable_diffusion", count: 2 }, { name: "Idle", count: 0 }]) {
  const catalog = new HordeImageCatalog({ transport: async () => json(rows) });
  await catalog.ensureFresh();
  return catalog;
}

/** A closed Horde API: `routes` answers by "METHOD path"; every call is recorded. */
function hordeApi(routes = {}) {
  const calls = [];
  const transport = async (url, init) => {
    const path = url.replace("https://aihorde.net/api", "");
    calls.push({ url, path, method: init.method, headers: init.headers, body: init.body, signal: init.signal });
    const key = `${init.method} ${path.replace(JOB, ":id")}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return typeof route === "function" ? route(calls, init) : route.clone();
  };
  return { calls, transport, count: (key) => calls.filter((c) => `${c.method} ${c.path.replace(JOB, ":id")}` === key).length };
}

const happyRoutes = (extra = {}) => ({
  "POST /v2/generate/async": () => json({ id: JOB, kudos: 12 }, 202),
  "GET /v2/generate/check/:id": () => json({ done: true, faulted: false, is_possible: true }),
  "GET /v2/generate/status/:id": () => json({ done: true, faulted: false, kudos: 11, generations: [{ img: IMG_URL, censored: false }] }),
  "DELETE /v2/generate/status/:id": () => json({}),
  ...extra,
});

function imageHost(answer = () => new Response(WEBP, { status: 200, headers: { "Content-Type": "image/webp" } })) {
  const calls = [];
  const downloadFetch = async (url, init) => { calls.push({ url: String(url), init }); return answer(url, init); };
  return { calls, downloadFetch };
}

async function adapterWith({ routes = happyRoutes(), catalog, host = imageHost(), ...options } = {}) {
  const api = hordeApi(routes);
  const adapter = createAiHordeImageAdapter({
    transport: api.transport, catalog: catalog ?? await readyCatalog(), downloadFetch: host.downloadFetch, pollMinMs: 1, pollMaxMs: 5, ...options,
  });
  return { adapter, api, host };
}

const run = (adapter, body = {}, credentials = { apiKey: KEY_A }, signal) =>
  adapter.generate({ model: "aihorde/stable_diffusion", body: { prompt: "a gate in a forest", ...body }, credentials, signal });

const bodyOf = async (result) => JSON.parse(await result.response.text());
const noSecrets = (text) => {
  for (const secret of [KEY_A, KEY_B, "SIGNEDSECRET", "1.1.1.1", "X-Amz"]) expect(text).not.toContain(secret);
};

describe("AI Horde request mapping", () => {
  it("builds the pinned source envelope for text-to-image", () => {
    expect(mapHordeImageRequest("horde/stable_diffusion", { prompt: "p", n: 2, size: "512x768", response_format: "b64_json", user: "u" })).toEqual({
      model: "stable_diffusion",
      n: 2,
      payload: {
        prompt: "p", models: ["stable_diffusion"], nsfw: false, censor_nsfw: true, r2: true, shared: false,
        validated_backends: true, slow_workers: true, allow_downgrade: true,
        params: { n: 2, width: 512, height: 768, steps: 20 },
      },
    });
  });
});

describe("AI Horde native image flow", () => {
  it("keyed: exact submit/check/status envelopes, apikey header, b64 result and unknown-cost accounting", async () => {
    const { adapter, api, host } = await adapterWith();
    const result = await run(adapter);
    expect(result.success).toBe(true);
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://aihorde.net/api/v2/generate/async",
      `GET https://aihorde.net/api/v2/generate/check/${JOB}`,
      `GET https://aihorde.net/api/v2/generate/status/${JOB}`,
    ]);
    for (const call of api.calls) {
      expect(call.headers).toEqual({ apikey: KEY_A, "Client-Agent": AI_HORDE_CLIENT_AGENT, Accept: "application/json", "Content-Type": "application/json" });
    }
    expect(JSON.parse(api.calls[0].body)).toEqual({
      prompt: "a gate in a forest", models: ["stable_diffusion"], nsfw: false, censor_nsfw: true, r2: true, shared: false,
      validated_backends: true, slow_workers: true, allow_downgrade: true, params: { n: 1, width: 1024, height: 1024, steps: 20 },
    });
    const payload = await bodyOf(result);
    expect(payload.data).toEqual([{ b64_json: WEBP.toString("base64"), mime_type: "image/webp", output_format: "webp" }]);
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", nativeUnits: { images: 1 }, tokens: {} });
    expect(result.accounting.meta).toMatchObject({ jobId: JOB, providerKudos: { path: "status.kudos", value: 11 } });
    expect(result.accounting.meta.partial).toBeUndefined();
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0].url).toBe(IMG_URL);
    const sent = JSON.stringify(host.calls[0].init.headers).toLowerCase();
    expect(sent).not.toMatch(/apikey|authorization|cookie|client-agent/);
    expect(sent).not.toContain(KEY_A.toLowerCase());
    expect(host.calls[0].init.redirect).toBe("manual");
  });

  it("anonymous: the sentinel key, and no other credential field is ever sent", async () => {
    const { adapter, api, host } = await adapterWith();
    const result = await run(adapter, {}, { accessToken: "tok-zzz", cookie: "sess=zzz", providerSpecificData: { apiKey: KEY_B } });
    expect(result.success).toBe(true);
    for (const call of api.calls) expect(call.headers.apikey).toBe("0000000000");
    const everything = JSON.stringify([api.calls.map(({ headers, body }) => ({ headers, body })), host.calls.map((c) => c.init.headers)]);
    for (const secret of ["tok-zzz", "sess=zzz", KEY_B]) expect(everything).not.toContain(secret);
  });

  it("two accounts in parallel each use only their own key", async () => {
    const { adapter, api } = await adapterWith();
    const [a, b] = await Promise.all([run(adapter, {}, { apiKey: KEY_A }), run(adapter, {}, { apiKey: ` ${KEY_B} ` })]);
    expect(a.success && b.success).toBe(true);
    const keys = api.calls.map((c) => c.headers.apikey);
    expect(keys.filter((k) => k === KEY_A)).toHaveLength(3);
    expect(keys.filter((k) => k === KEY_B)).toHaveLength(3);
    expect(api.count("POST /v2/generate/async")).toBe(2);
  });

  it.each([
    ["n above 4", { n: 5 }, /n must be an integer from 1 to 4/],
    ["n zero", { n: 0 }, /n must be/],
    ["fractional n", { n: 1.5 }, /n must be/],
    ["size not on the 64 grid", { size: "1000x1000" }, /size must be/],
    ["size above 3072", { size: "4096x64" }, /size must be/],
    ["malformed size", { size: "large" }, /size must be/],
    ["url output", { response_format: "url" }, /b64_json only/],
    ["source image", { image: "data:image/png;base64,AAAA" }, /do not support: image/],
    ["unsupported option", { quality: "hd", style: "vivid" }, /do not support: quality, style/],
    ["empty prompt", { prompt: "  " }, /text prompt/],
  ])("refuses %s with 400 before catalog or submit", async (_, body, message) => {
    let catalogCalls = 0;
    const catalog = new HordeImageCatalog({ transport: async () => { catalogCalls++; return json([]); } });
    const { adapter, api, host } = await adapterWith({ catalog });
    const result = await run(adapter, body);
    expect(result).toMatchObject({ success: false, status: 400, outcome: "refused" });
    expect(result.error).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(catalogCalls + api.calls.length + host.calls.length).toBe(0);
  });

  it.each([["unknown", "aihorde/nope"], ["zero-worker", "Idle"]])("an %s model is refused with 400 before submit", async (_, model) => {
    const { adapter, api } = await adapterWith();
    const result = await adapter.generate({ model, body: { prompt: "p" }, credentials: { apiKey: KEY_A } });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(/No AI Horde workers/);
    expect(api.calls).toHaveLength(0);
  });

  it("a cold catalog failure refuses with 503 instead of submitting unchecked", async () => {
    const catalog = new HordeImageCatalog({ transport: async () => json({}, 500) });
    const { adapter, api } = await adapterWith({ catalog });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.acceptedJob).toBeUndefined();
    expect(api.calls).toHaveLength(0);
  });

  it("submit 200 without an id is a possibly accepted job: no replay, no cancel", async () => {
    const { adapter, api } = await adapterWith({ routes: happyRoutes({ "POST /v2/generate/async": () => json({ kudos: 5 }) }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "outcome_unknown" });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", cost: null, meta: { jobState: "accepted_without_id" } });
    expect(api.calls).toHaveLength(1);
  });

  it("a redirected submit is refused and never followed", async () => {
    const { adapter, api, host } = await adapterWith({
      routes: happyRoutes({ "POST /v2/generate/async": () => new Response(null, { status: 307, headers: { Location: "https://evil.example/collect" } }) }),
    });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(api.calls).toHaveLength(1);
    expect(host.calls).toHaveLength(0);
  });

  it.each([
    [400, 400], [401, 401], [403, 403], [404, 404], [429, 429], [503, 503], [413, 502],
  ])("definitive submit refusal HTTP %i maps to %i without an accepted job", async (upstream, status) => {
    const { adapter, api } = await adapterWith({
      routes: happyRoutes({ "POST /v2/generate/async": () => json({ message: `bad key ${KEY_A}` }, upstream) }),
    });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status, outcome: "refused" });
    expect(result.acceptedJob).toBeUndefined();
    noSecrets(result.error);
    noSecrets(await result.response.text());
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    ["HTTP 500", () => json({}, 500)],
    ["HTTP 201", () => json({ id: JOB }, 201)],
    ["a transport error", () => { throw new Error(`connect ECONNRESET ${KEY_A}`); }],
  ])("an uncertain submit (%s) carries an accepted job and is never replayed", async (_, answer) => {
    const { adapter, api } = await adapterWith({ routes: happyRoutes({ "POST /v2/generate/async": answer }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "outcome_unknown" });
    expect(result.acceptedJob.meta.jobState).toBe("submit_outcome_unknown");
    noSecrets(result.error);
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    ["faulted", () => json({ done: false, faulted: true }), 502, "faulted"],
    ["impossible", () => json({ done: false, faulted: false, is_possible: false }), 503, "impossible"],
    ["HTTP 500", () => json({}, 500), 502, "outcome_unknown"],
    ["malformed JSON", () => new Response("not json", { status: 200 }), 502, "outcome_unknown"],
    ["redirect", () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }), 502, "outcome_unknown"],
    ["transport error", () => { throw new Error("socket closed"); }, 502, "outcome_unknown"],
  ])("a polling fault (%s) cancels once and is not resubmitted", async (_, answer, status, jobState) => {
    const { adapter, api } = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/check/:id": answer }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob.meta).toMatchObject({ jobState, jobId: JOB, cancel: "requested" });
    expect(api.count("DELETE /v2/generate/status/:id")).toBe(1);
    expect(api.count("POST /v2/generate/async")).toBe(1);
    expect(api.count("GET /v2/generate/status/:id")).toBe(0);
    const cancel = api.calls.find((c) => c.method === "DELETE");
    expect(cancel.headers.apikey).toBe(KEY_A);
    expect(cancel.signal.aborted).toBe(false);
  });

  it("an overall deadline stops polling with 504 and a bounded cancel", async () => {
    const { adapter, api } = await adapterWith({
      timeoutMs: 60,
      routes: happyRoutes({ "GET /v2/generate/check/:id": () => json({ done: false, wait_time: 0 }) }),
    });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 504, outcome: "timeout" });
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "outcome_unknown", cancel: "requested" });
    expect(api.count("POST /v2/generate/async")).toBe(1);
    expect(api.count("DELETE /v2/generate/status/:id")).toBe(1);
  });

  it("a queue wait longer than the remaining budget stops early with 504", async () => {
    const { adapter, api } = await adapterWith({
      routes: happyRoutes({ "GET /v2/generate/check/:id": () => json({ done: false, wait_time: 900, queue_position: 40 }) }),
    });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.error).toMatch(/queue wait/);
    expect(api.count("GET /v2/generate/check/:id")).toBe(1);
    expect(api.count("DELETE /v2/generate/status/:id")).toBe(1);
  });

  it("a caller abort during polling returns 499 and cancels without touching other jobs", async () => {
    const aborter = new AbortController();
    const { adapter, api } = await adapterWith({
      routes: happyRoutes({
        "GET /v2/generate/check/:id": (calls) => {
          if (calls.filter((c) => c.method === "GET").length === 2) aborter.abort();
          return json({ done: false, wait_time: 0 });
        },
      }),
    });
    const result = await run(adapter, {}, { apiKey: KEY_A }, aborter.signal);
    expect(result).toMatchObject({ success: false, status: 499, outcome: "aborted" });
    expect(result.acceptedJob.meta.cancel).toBe("requested");
    expect(api.count("DELETE /v2/generate/status/:id")).toBe(1);
    expect(api.count("POST /v2/generate/async")).toBe(1);
  });

  it("a caller abort before submit sends nothing", async () => {
    const { adapter, api } = await adapterWith();
    const result = await run(adapter, {}, { apiKey: KEY_A }, AbortSignal.abort());
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(api.calls).toHaveLength(0);
  });

  it("a failed cancel is reported, not hidden", async () => {
    const { adapter } = await adapterWith({
      routes: happyRoutes({
        "GET /v2/generate/check/:id": () => json({ faulted: true }),
        "DELETE /v2/generate/status/:id": () => { throw new Error("down"); },
      }),
    });
    const result = await run(adapter);
    expect(result.acceptedJob.meta.cancel).toBe("failed");
  });

  it.each([
    ["no generations", { generations: [] }],
    ["malformed generations", { generations: "x" }],
    ["only censored output", { generations: [{ img: IMG_URL, censored: true }] }],
  ])("a finished job with %s is a truthful failure, not a success", async (_, status) => {
    const { adapter, api, host } = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/status/:id": () => json({ done: true, ...status }) }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "completed_without_images" });
    expect(result.acceptedJob.meta.jobState).toBe("completed_without_images");
    expect(api.count("DELETE /v2/generate/status/:id")).toBe(0);
    expect(host.calls).toHaveLength(0);
  });

  it("a faulted status result is reported as faulted", async () => {
    const { adapter } = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/status/:id": () => json({ done: true, faulted: true, generations: [] }) }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "faulted" });
  });

  it("a partial job returns only the real images and says so in accounting", async () => {
    const { adapter, api } = await adapterWith({
      routes: happyRoutes({
        "GET /v2/generate/status/:id": () => json({ done: true, generations: [{ img: IMG_URL }, { img: IMG_URL, censored: true }, { nope: 1 }] }),
      }),
    });
    const result = await run(adapter, { n: 3 });
    expect(result.success).toBe(true);
    expect((await bodyOf(result)).data).toHaveLength(1);
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.meta.partial).toEqual({ requested: 3, returned: 1 });
    expect(JSON.parse(api.calls[0].body).params.n).toBe(3);
  });

  it("an inline base64 result is accepted only when it is a real image", async () => {
    const ok = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/status/:id": () => json({ generations: [{ img: PNG.toString("base64") }] }) }) });
    const result = await run(ok.adapter);
    expect((await bodyOf(result)).data[0]).toMatchObject({ output_format: "png", mime_type: "image/png" });
    expect(ok.host.calls).toHaveLength(0);
    const bad = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/status/:id": () => json({ generations: [{ img: Buffer.from("hello world").toString("base64") }] }) }) });
    expect(await run(bad.adapter)).toMatchObject({ success: false, outcome: "download_failed" });
  });

  it.each([
    ["plain http", "http://1.1.1.1/a.webp"],
    ["embedded credentials", "https://user:pass@1.1.1.1/a.webp"],
    ["loopback", "https://127.0.0.1/a.webp"],
    ["private LAN", "https://10.0.0.5/a.webp"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["localhost name", "https://localhost/a.webp"],
    ["file protocol", "file:///etc/passwd"],
    ["javascript protocol", "javascript:alert(1)"],
  ])("refuses an unsafe result URL (%s) without fetching it", async (_, url) => {
    const { adapter, host } = await adapterWith({ routes: happyRoutes({ "GET /v2/generate/status/:id": () => json({ generations: [{ img: url }] }) }) });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "download_failed" });
    expect(result.acceptedJob.meta.jobState).toBe("completed_download_failed");
    expect(host.calls).toHaveLength(0);
    expect(result.error).not.toContain(url);
  });

  it.each([
    ["a redirect", () => new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/x" } })],
    ["HTTP 403", () => new Response("denied", { status: 403 })],
    ["an HTML body", () => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } })],
    ["non-image bytes", () => new Response(Buffer.from("plain text here"), { status: 200, headers: { "Content-Type": "image/webp" } })],
    ["an empty body", () => new Response(Buffer.alloc(0), { status: 200 })],
    ["oversized bytes", () => new Response(Buffer.concat([WEBP, Buffer.alloc(200)]), { status: 200 })],
    ["a declared oversize", () => new Response(WEBP, { status: 200, headers: { "Content-Length": "999999" } })],
  ])("a download with %s fails truthfully and leaks nothing", async (_, answer) => {
    const host = imageHost(answer);
    const { adapter, api } = await adapterWith({ host, maxImageBytes: 100 });
    const result = await run(adapter);
    expect(result).toMatchObject({ success: false, status: 502, outcome: "download_failed" });
    expect(host.calls).toHaveLength(1);
    expect(api.count("POST /v2/generate/async")).toBe(1);
    noSecrets(result.error);
    noSecrets(await result.response.text());
  });
});
