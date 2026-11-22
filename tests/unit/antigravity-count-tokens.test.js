import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), instances: [] }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("../../open-sse/executors/antigravity.js", () => ({
  AntigravityExecutor: class {
    constructor() { mocks.instances.push(this); }
    getBaseUrls() { return ["https://antigravity.test"];
    }
    buildHeaders(credentials) { return { Authorization: `Bearer ${credentials.accessToken}`, "User-Agent": "antigravity-test" }; }
    transformRequest(model, body, stream, credentials) {
      return { project: credentials.projectId, userAgent: "antigravity", requestType: "count_tokens", requestId: credentials.connectionId,
        request: { model, stream: true, sessionId: "session", contents: body.request?.contents || [], tools: body.request?.tools || [] } };
    }
  },
}));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ buildHeaders: () => ({}) }) }));

const { countAntigravityTokens } = await import("../../open-sse/executors/antigravity-count-tokens.js");
const { countInputTokens, estimateTokens } = await import("../../open-sse/handlers/countTokensCore.js");

const body = { request: {
  contents: [{ role: "user", parts: [{ text: "hello" }] }],
  tools: [{ functionDeclarations: [{ name: "f", parameters: { type: "OBJECT", title: "discard", properties: { x: { type: "STRING", default: "x" } } } }] }],
} };

describe("Antigravity native CountTokens", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.instances.length = 0; });

  it("sends the native envelope with model set, stream stripped, and schemas sanitized", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ totalTokens: 27 }), { status: 200 }));
    const result = await countAntigravityTokens({ body, model: "gemini-3-pro", credentials: { connectionId: "c1", accessToken: "t1", projectId: "p1" } });
    expect(result).toEqual({ tokens: 27 });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://antigravity.test/v1internal:countTokens");
    expect(init.headers).toMatchObject({ Authorization: "Bearer t1", "User-Agent": "antigravity-test" });
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ project: "p1", request: { model: "gemini-3-pro" } });
    expect(sent.request.stream).toBeUndefined();
    expect(sent.request.sessionId).toBe("session");
    expect(sent.request.tools[0].functionDeclarations[0].parameters).toEqual({ type: "OBJECT", properties: { x: { type: "STRING" } } });
  });

  it("translates the public Claude count request into Antigravity contents", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ totalTokens: 4 }), { status: 200 }));
    await countAntigravityTokens({
      body: { model: "m", messages: [{ role: "user", content: "count me" }] },
      model: "m", credentials: { accessToken: "t", projectId: "p" },
    });
    const sent = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(sent.request.contents).toContainEqual({ role: "user", parts: [{ text: "count me" }] });
  });

  it("returns 429 and 401 distinctly for cooldown and credential handling", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect((await countAntigravityTokens({ body, model: "m", credentials: { accessToken: "t" } })).status).toBe(429);
    expect((await countAntigravityTokens({ body, model: "m", credentials: { accessToken: "t" } })).status).toBe(401);
  });

  it("falls back to the labeled local estimate on a 5xx", async () => {
    mocks.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const result = await countInputTokens({ body, modelInfo: { provider: "antigravity", model: "m" }, credentials: { accessToken: "t" } });
    expect(result).toEqual({ tokens: estimateTokens(body), approximate: true });
  });

  it("returns successful counts and isolates the selected connection's project and token", async () => {
    mocks.fetch.mockImplementation(() => new Response(JSON.stringify({ totalTokens: 8 }), { status: 200 }));
    await countAntigravityTokens({ body, model: "m", credentials: { connectionId: "a", accessToken: "ta", projectId: "pa" } });
    await countAntigravityTokens({ body, model: "m", credentials: { connectionId: "b", accessToken: "tb", projectId: "pb" } });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ project: "pa", requestId: "a" });
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toMatchObject({ project: "pb", requestId: "b" });
    expect(mocks.fetch.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer ta", "Bearer tb"]);
  });
});
