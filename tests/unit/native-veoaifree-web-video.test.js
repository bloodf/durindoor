import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequest, config, createVeoAiFreeVideoAdapter, sessionCookie, USER_AGENT } from "../../open-sse/services/providerParity/native-veoaifree-web-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
const origin = "https://veoaifree.com";
const input = { model: "veo", body: { prompt: "rain" }, credentials: { connectionId: "one", apiKey: "secret" } };
const run = (options = {}, override = {}) => createVeoAiFreeVideoAdapter({ pollIntervalMs: 0, ...options }).generate({ ...input, ...override });
function network(values) {
  const fn = vi.fn(async () => {
    const value = values.shift();
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : new Response(value);
  });
  vi.stubGlobal("fetch", fn); return fn;
}
afterEach(() => { vi.unstubAllGlobals(); });
it("preserves pinned metadata and static model discovery", () => {
  expect(config).toMatchObject({ id: "veoaifree-web", alias: "veo-free", authType: "none", authHeader: "none", format: "veoaifree-web" });
  expect(config.models.map((m) => m.id)).toEqual(["veo", "seedance"]);
});
it("uses source-derived session, nonce and exact form envelope without bearer auth", async () => {
  const fetch = network([new Response('nonce":"abcdef"', { headers: { "set-cookie": "session=site; Secure" } }), "scene", "https://cdn.example.com/video.mp4"]);
  const result = await run();
  expect(result.success).toBe(true);
  expect(await result.response.json()).toMatchObject({ data: [{ url: "https://cdn.example.com/video.mp4", type: "video" }] });
  expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", nativeUnits: { videos: 1 } });
  expect(fetch.mock.calls[0][0]).toBe(origin);
  expect(fetch.mock.calls[0][1].headers).toEqual({ "User-Agent": USER_AGENT, Referer: `${origin}/` });
  const [, submit] = fetch.mock.calls[1];
  expect(submit.headers).toEqual({ "User-Agent": USER_AGENT, Referer: `${origin}/`, Origin: origin, "Content-Type": "application/x-www-form-urlencoded", Cookie: "wordpress_logged_in=secret; session=site" });
  expect(submit.redirect).toBe("manual");
  expect(Object.fromEntries(new URLSearchParams(submit.body))).toEqual({ action: "veo_video_generator", nonce: "abcdef", prompt: "rain", totalVariations: "1", aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE", actionType: "full-video-generate" });
  expect(Object.fromEntries(new URLSearchParams(fetch.mock.calls[2][1].body))).toEqual({ action: "veo_video_generator", nonce: "abcdef", sceneData: "scene", actionType: "final-video-results" });
});
it("keeps two selected sessions separate and accepts stored cookie representations", async () => {
  expect(sessionCookie({ apiKey: '[{"name":"wordpress_logged_in_x","value":"a"}]' })).toBe("wordpress_logged_in_x=a");
  expect(sessionCookie({ apiKey: '{"wordpress_logged_in_x":"b"}' })).toBe("wordpress_logged_in_x=b");
  expect(sessionCookie({ providerSpecificData: { cookie: "x=c" }, apiKey: "ignored" })).toBe("x=c");
  const fetch = network(['nonce":"aa"', "scene", "https://cdn.example.com/a", 'nonce":"bb"', "scene2", "https://cdn.example.com/b"]);
  await run(); await run({}, { credentials: { connectionId: "two", apiKey: "second" } });
  expect(fetch.mock.calls[4][1].headers.Cookie).toBe("wordpress_logged_in=second");
  expect(fetch.mock.calls[3][1].headers.Cookie).toBeUndefined();
});
it.each([{ duration: 8 }, { image: "x" }, { stream: true }, { response_format: "b64_json" }, { n: 2 }, { size: "1024x768" }])("rejects unsupported inputs before submit %j", async (extra) => {
  const fetch = network([]);
  expect((await run({}, { body: { prompt: "rain", ...extra } })).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses unknown models and header injection", () => {
  expect(() => buildRequest("image", input.body)).toThrow();
  expect(() => sessionCookie({ apiKey: "x\r\ny" })).toThrow();
});
it.each([["please login", 401], ["rate-limit-exceed", 429], ["error secret", 502], ["0", 502]])("sanitizes source failure %s", async (answer, status) => {
  network(['nonce":"aa"', answer]);
  const result = await run();
  expect(result.status).toBe(status);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it.each(["http://cdn.example.com/a", "https://127.0.0.1/a", "https://u:p@cdn.example.com/a", "https://cdn.example.com:444/a"])('refuses unsafe result %s', async (url) => {
  network(['nonce":"aa"', "scene", url]);
  const result = await run(); expect(result.success).toBe(false); expect(result.acceptedJob).toBeTruthy();
});
it("does not replay uncertain submission or follow redirects", async () => {
  const fetch = network(['nonce":"aa"', new Error("secret")]);
  expect((await run()).acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job" });
  expect(fetch).toHaveBeenCalledTimes(2);
  const redirected = network([new Response(null, { status: 302, headers: { location: "http://localhost" } })]);
  expect((await run()).success).toBe(false); expect(redirected).toHaveBeenCalledTimes(1);
});
it("bounds hanging requests and total polling, aborting the network", async () => {
  let observed;
  vi.stubGlobal("fetch", vi.fn((url, init) => { observed = init.signal; return new Promise(() => {}); }));
  expect((await run({ requestTimeoutMs: 5 })).status).toBe(504); expect(observed.aborted).toBe(true);
  network(['nonce":"aa"', "scene", "0"]);
  expect((await run({ maxPolls: 1 })).acceptedJob).toBeTruthy();
  network(['nonce":"aa"', "scene"]);
  expect((await run({ timeoutMs: 5, pollIntervalMs: 100 })).status).toBe(504);
});
it("cancels before send and during polling with honest accepted accounting", async () => {
  const controller = new AbortController(); controller.abort(); const fetch = network([]);
  expect((await run({}, { signal: controller.signal })).status).toBe(499); expect(fetch).not.toHaveBeenCalled();
  const later = new AbortController();
  const fn = network(['nonce":"aa"', "scene"]);
  fn.mockImplementationOnce(async () => new Response('nonce":"aa"')).mockImplementationOnce(async () => { setTimeout(() => later.abort(), 1); return new Response("scene"); });
  const result = await run({ pollIntervalMs: 100 }, { signal: later.signal });
  expect(result.status).toBe(499); expect(result.acceptedJob).toBeTruthy();
});
it("bounds malformed and oversized answers", async () => {
  network(["no nonce"]); expect((await run()).acceptedJob).toBeUndefined();
  network(['nonce":"aa"', "x".repeat(65537)]); expect((await run()).acceptedJob).toBeTruthy();
});
it("maps HTTP quota failures without exposing response bodies", async () => {
  network(['nonce":"aa"', new Response("private secret", { status: 429 })]);
  const result = await run();
  expect(result.status).toBe(429);
  expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  expect(JSON.stringify(result)).not.toContain("private secret");
});
it("updates the private session from submit responses for polling", async () => {
  const fetch = network(['nonce":"aa"', new Response("scene", { headers: { "set-cookie": "fresh=value; Secure" } }), "https://cdn.example.com/a"]);
  await run();
  expect(fetch.mock.calls[2][1].headers.Cookie).toBe("wordpress_logged_in=secret; fresh=value");
});
it("aborts hanging response bodies within the per-call deadline", async () => {
  let cancelled = false;
  network([new Response(new ReadableStream({ cancel() { cancelled = true; } }))]);
  const result = await run({ requestTimeoutMs: 5 });
  expect(result.status).toBe(504);
  expect(result.acceptedJob).toBeUndefined();
  expect(cancelled).toBe(true);
});
// Isolated registration block: the positive registry identity check.
describe("canonical registration", () => {
  it("registers the default adapter for the canonical id and the veo-free alias", async () => {
    const { default: adapter } = await import("../../open-sse/services/providerParity/native-veoaifree-web-video/index.js");
    expect(getVideoGenerationAdapter("veoaifree-web")).toBe(adapter);
    expect(getVideoGenerationAdapter("veo-free")).toBe(adapter);
  });
});
