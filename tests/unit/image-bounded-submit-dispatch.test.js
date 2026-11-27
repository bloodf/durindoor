// The image core reports each dispatch the provider answered through
// onUpstreamDispatch, so account health binds to the credential that was sent.
// Adapter submit policies (bounded submit, adapter-owned auth retry) route
// through the same path: a refreshed retry reports the refreshed snapshot, and
// a submit that timed out unanswered reports nothing. Closed network: every
// request is answered by the stubbed fetch below.
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getImageAdapter: (id) => (id === "bounded-fixture" ? m.adapter : actual.getImageAdapter(id)) };
});

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");

const adapterWith = (extra = {}) => ({
  submitTimeoutMs: 50,
  buildUrl: () => "https://images.fixture.invalid/v1/generate",
  buildBody: async () => ({ prompt: "fixture" }),
  buildHeaders: (credentials) => ({ authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" }),
  ...extra,
});
/** Answers by the bearer token the dispatch presented; `hang` never answers. */
const upstream = (byToken) => vi.stubGlobal("fetch", vi.fn((_url, init) => {
  const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
  const answer = byToken[token];
  if (answer === "hang") return new Promise(() => {});
  return Promise.resolve(answer ? answer() : new Response("unexpected", { status: 500 }));
}));
const run = (options) => {
  const dispatches = [];
  const result = handleImageGenerationCore({
    body: { prompt: "fixture" },
    modelInfo: { provider: "bounded-fixture", model: "img" },
    credentials: { accessToken: "old-access", refreshToken: "old-refresh" },
    onUpstreamDispatch: (sent, at) => dispatches.push({ token: sent.accessToken, at }),
    ...options,
  });
  return { dispatches, result };
};

afterEach(() => { vi.unstubAllGlobals(); m.adapter = null; });

describe("bounded image submit dispatch reporting", () => {
  it("reports the pre-refresh and refreshed snapshots for a bounded submit retried after 401", async () => {
    m.adapter = adapterWith();
    upstream({ "old-access": () => new Response("denied", { status: 401 }), "new-access": () => new Response("busy", { status: 503 }) });
    const refreshCredentials = vi.fn(async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }));
    const { dispatches, result } = run({ refreshCredentials });
    const outcome = await result;

    expect(refreshCredentials).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe(503);
    expect(dispatches.map((d) => d.token)).toEqual(["old-access", "new-access"]);
    expect(dispatches[1].at).toBeGreaterThanOrEqual(dispatches[0].at);
  });

  it("does not report a refreshed bounded submit that timed out without an answer", async () => {
    m.adapter = adapterWith();
    upstream({ "old-access": () => new Response("denied", { status: 401 }), "new-access": "hang" });
    const { dispatches, result } = run({ refreshCredentials: async () => ({ accessToken: "new-access" }) });
    await result;

    expect(dispatches.map((d) => d.token)).toEqual(["old-access"]);
  });

  it("reports nothing and keeps the possibly billed job when the first bounded submit times out", async () => {
    m.adapter = adapterWith({ submitOutcomeUnknown: true });
    upstream({ "old-access": "hang" });
    const { dispatches, result } = run({});
    const outcome = await result;

    expect(outcome.status).toBe(504);
    expect(outcome.acceptedJob?.meta?.jobState).toBe("submit-unknown");
    expect(dispatches).toEqual([]);
  });

  it("reports both dispatches of an adapter-owned auth retry", async () => {
    let calls = 0;
    upstream({ "old-access": () => new Response(calls++ ? "busy" : "denied", { status: calls === 1 ? 401 : 503 }) });
    m.adapter = adapterWith({ onSubmitAuthRejected: async ({ retry }) => retry });
    const { dispatches, result } = run({});
    const outcome = await result;

    expect(outcome.status).toBe(503);
    expect(dispatches.map((d) => d.token)).toEqual(["old-access", "old-access"]);
  });
});
