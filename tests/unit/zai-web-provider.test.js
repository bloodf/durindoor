import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ calls: [], reply: null }));
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));

const ORIGIN = "https://chat.z.ai";
let root, routes, handleChat;
let ZaiWebExecutor, extractZaiWebToken;
const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
const jwt = (uid) => `header.${Buffer.from(JSON.stringify({ id: uid })).toString("base64url")}.signature`;
const cookie = (token) => `token=${token}`;
const connection = async (name, apiKey) => {
  const result = await routes.providers.POST(request("/api/providers", { provider: "zai-web", name, apiKey }));
  expect(result.status).toBe(201);
  return (await result.json()).connection;
};
const syntheticUpstream = (liveTokens) => async (url, init) => {
  const auth = init.headers.Authorization;
  const token = auth?.replace(/^Bearer /, "");
  wire.calls.push({ url: String(url), token, body: init.body && JSON.parse(init.body) });
  if (!liveTokens.has(token)) return new Response("expired", { status: 401 });
  if (String(url) === `${ORIGIN}/api/v1/chats/new`) return Response.json({ id: "mock-chat" });
  if (String(url).startsWith(`${ORIGIN}/api/v2/chat/completions?`)) {
    if (wire.reply?.status) return new Response("quota", { status: wire.reply.status });
    return new Response(`data: ${JSON.stringify({ data: { phase: "thinking", delta_content: "reason" } })}\n\ndata: ${JSON.stringify({ data: { phase: "answer", delta_content: "hello" } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  }
  if (String(url) === `${ORIGIN}/api/models`) return Response.json({ data: [{ id: "glm-5.3" }] });
  throw new Error(`unexpected mocked URL ${url}`);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "zai-web-test-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  wire.calls = []; wire.reply = null;
  requestProof = null;
  vi.stubGlobal("fetch", vi.fn(syntheticUpstream(new Set([jwt("a"), jwt("b")]))));
  routes = { providers: await import("../../src/app/api/providers/route.js"), validate: await import("../../src/app/api/providers/validate/route.js"), models: await import("../../src/app/api/v1/models/route.js"), messages: await import("../../src/app/api/v1/messages/route.js") };
  ({ ZaiWebExecutor, extractZaiWebToken } = await import("../../open-sse/executors/zai-web.js"));
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

/** Synthetic opaque proof the next openai() sends; it only proves forwarding, never provider validity. */
let requestProof = null;
const openai = (model = "zw/glm-5.3", extra = {}) => handleChat(request("/v1/chat/completions", { model, messages: [{ role: "user", content: "ping" }], ...(requestProof ? { captcha_verify_param: requestProof } : null), ...extra }));
const completionCalls = () => wire.calls.filter((call) => call.url.startsWith(`${ORIGIN}/api/v2/chat/completions?`));
const expectProofInBodyOnly = (call, proof) => {
  expect(call.body.captcha_verify_param).toBe(proof);
  expect(call.url).not.toContain(proof);
};
/** Adds a distinct synthetic proof to a direct executor input. */
const withProof = (input, proof) => ({ ...input, body: { ...input.body, captcha_verify_param: proof } });

describe("Z.ai Web private provider port", () => {
  it("validates token-shaped credentials, lists models, and handles JSON and SSE chat", async () => {
    const saved = await connection("zai-a", cookie(jwt("a")));
    expect(extractZaiWebToken("not-a-token; malformed")).toBe("");
    expect(extractZaiWebToken(cookie(jwt("a")))).toBe(jwt("a"));
    const invalid = await new ZaiWebExecutor().execute({ body: { model: "glm-5.3", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: "not-a-token; malformed" } });
    expect(invalid.response.status).toBe(401);
    const catalog = await (await routes.models.GET(request("/v1/models", null, "GET"))).json();
    expect(catalog.data.map((model) => model.id)).toEqual(expect.arrayContaining(["zw/glm-5.3", "zw/glm-5.3-flash"]));
    requestProof = "synthetic-proof-json";
    const json = await openai();
    expect(json.status).toBe(200);
    expect((await json.json()).choices[0].message).toMatchObject({ content: "hello", reasoning_content: "reason" });
    requestProof = "synthetic-proof-sse";
    const stream = await (await openai("zw/glm-5.3", { stream: true })).text();
    expect(stream).toContain('"content":"hello"'); expect(stream).toContain("[DONE]");
    expect(completionCalls()).toHaveLength(2);
    expectProofInBodyOnly(completionCalls()[0], "synthetic-proof-json");
    expectProofInBodyOnly(completionCalls()[1], "synthetic-proof-sse");
    expect(saved.authType).toBe("cookie");
  });

  it("serves the Anthropic Messages route from the same mocked executor", async () => {
    await connection("zai-a", cookie(jwt("a")));
    // Anthropic translation keeps only Messages fields, so the proof uses the source's stored-credential location.
    const { getProviderConnections, updateProviderConnection } = await import("../../src/lib/localDb.js");
    const [saved] = await getProviderConnections({ provider: "zai-web" });
    await updateProviderConnection(saved.id, { providerSpecificData: { ...saved.providerSpecificData, captchaVerifyParam: "synthetic-proof-messages" } });
    const response = await routes.messages.POST(request("/v1/messages", { model: "zw/glm-5.3", max_tokens: 64, messages: [{ role: "user", content: "ping" }] }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("hello");
    expect(completionCalls()).toHaveLength(1);
    expectProofInBodyOnly(completionCalls()[0], "synthetic-proof-messages");
  });

  it("maps expired sessions and quota responses and keeps two cookie sessions isolated", async () => {
    await connection("zai-a", cookie(jwt("a")));
    await connection("zai-b", cookie(jwt("b")));
    requestProof = "synthetic-proof-route";
    const result = await openai();
    expect(result.status).toBe(200);
    const executor = new ZaiWebExecutor();
    const directInput = (id) => ({ body: { model: "glm-5.3", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: cookie(jwt(id)) } });
    const beforeDirect = wire.calls.length;
    const first = await executor.execute(withProof(directInput("a"), "synthetic-proof-a"));
    const second = await executor.execute(withProof(directInput("b"), "synthetic-proof-b"));
    expect(first.response.status).toBe(200); expect(second.response.status).toBe(200);
    expect(wire.calls.slice(beforeDirect).map((call) => call.token)).toEqual([jwt("a"), jwt("a"), jwt("b"), jwt("b")]);
    const directCompletions = wire.calls.slice(beforeDirect).filter((call) => call.url.startsWith(`${ORIGIN}/api/v2/chat/completions?`));
    expectProofInBodyOnly(directCompletions[0], "synthetic-proof-a");
    expectProofInBodyOnly(directCompletions[1], "synthetic-proof-b");
    await connection("zai-expired", cookie(jwt("expired")));
    vi.stubGlobal("fetch", vi.fn(syntheticUpstream(new Set())));
    const expired = await executor.execute(withProof({ body: { model: "glm-5.3", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: cookie(jwt("expired")) } }, "synthetic-proof-expired"));
    expect(expired.response.status).toBe(401);
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url) === `${ORIGIN}/api/v1/chats/new`) return Response.json({ id: "mock-chat" });
      return new Response("quota", { status: 429 });
    }));
    const throttled = await executor.execute(withProof({ body: { model: "glm-5.3", messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey: cookie(jwt("a")) } }, "synthetic-proof-throttled"));
    expect(throttled.response.status).toBe(429);
  });
});
