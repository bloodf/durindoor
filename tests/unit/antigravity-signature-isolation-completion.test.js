import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// #2034 follow-up to OmniRoute PR 21439 (MIT, head 35e01594ad13a7ffc0cd44d6598f6d862dfcff9f).
// Real handleChatCore, translators and AntigravityExecutor; only the outbound
// transport is mocked. Two synthetic accounts and client sessions, no network.
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), agy: null, queue: [], dbLocked: false }));

// While `dbLocked` holds, the adapter is not open yet and opening it fails the way
// a concurrent migration in another process makes it fail; the real driver otherwise.
vi.mock("../../src/lib/db/driver.js", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getAdapterSync: () => {
      if (mocks.dbLocked) throw new Error("[DB] adapter not initialized — await getAdapter() first");
      return real.getAdapterSync();
    },
    getAdapter: async () => {
      if (mocks.dbLocked) throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      return real.getAdapter();
    },
  };
});

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: mocks.fetch,
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: (options) => mocks.agy.execute(options) }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const store = await import("../../open-sse/services/thoughtSignatureStore.js");
const { decodeToolCallId, encodeToolCallIdWithSignature } = await import("../../open-sse/translator/concerns/signatureTransport.js");
const { DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } = await import("../../open-sse/config/defaultThinkingSignature.js");

const GEMINI = "gemini-4-argon";
const SIG_A = "Rsynthetic-isolation-A";
const SIG_B = "Rsynthetic-isolation-B";
const SIG_LEGACY = "Rsynthetic-isolation-legacy";
const ANTHROPIC_ID = /^[a-zA-Z0-9_-]+$/;
let seq = 0;
const uid = (name) => `${name}-${Date.now()}-${seq++}`;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const usage = { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 };
const envelope = (parts, finishReason = "STOP") => ({
  response: { responseId: "r1", candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata: usage },
});
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const sse = (body) => new Response(`data: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
const call = (name, id, args = {}) => ({ functionCall: { name, ...(id && { id }), args } });

const isGeneration = (url) => !String(url).includes(":countTokens");
const sent = () => mocks.fetch.mock.calls.filter(([url]) => isGeneration(url)).map(([, init]) => JSON.parse(init.body));
const upstream = (...responses) => mocks.queue.push(...responses);
const lastSent = () => sent().at(-1);
const sentParts = (body = lastSent()) => body.request.contents.flatMap((c) => c.parts);
const sentCalls = (body = lastSent()) => sentParts(body).filter((p) => p.functionCall);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const TOOLS = ["read", "list"].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: { p: { type: "string" } } } },
}));
const CLAUDE_TOOLS = ["read", "list"].map((name) => ({
  name, input_schema: { type: "object", properties: { p: { type: "string" } } },
}));

function run({ body, format = "openai", account = "acct-A", session = "sess-1", model = GEMINI, forceStream = false }) {
  const credentials = {
    accessToken: "synthetic-token", projectId: "synthetic-project",
    ...(account && { connectionId: account }),
    ...(session && { rawHeaders: { "x-session-id": session } }),
  };
  const endpoint = format === "claude" ? "/v1/messages" : "/v1/chat/completions";
  return handleChatCore({
    body,
    modelInfo: { provider: "antigravity", model },
    credentials,
    connectionId: account || undefined,
    sourceFormatOverride: format,
    ...(forceStream && { executorOverride: { noAuth: true, forceStream: true, execute: (options) => mocks.agy.execute(options) } }),
    clientRawRequest: { endpoint, headers: session ? { "x-session-id": session } : {} },
    log,
  });
}

const turn1 = {
  openai: (stream) => ({ model: GEMINI, stream, max_tokens: 256, tools: TOOLS, messages: [{ role: "user", content: "inspect" }] }),
  claude: (stream) => ({ model: GEMINI, stream, max_tokens: 256, tools: CLAUDE_TOOLS, messages: [{ role: "user", content: "inspect" }] }),
};
// Clients that keep only the raw upstream id (no transport-encoded signature).
const turn2 = {
  openai: (id, name = "read") => ({
    model: GEMINI, stream: false, max_tokens: 256, tools: TOOLS,
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] },
      { role: "tool", tool_call_id: id, content: `${name}-ok` },
    ],
  }),
  claude: (id, name = "read") => ({
    model: GEMINI, stream: false, max_tokens: 256, tools: CLAUDE_TOOLS,
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `${name}-ok` }] },
    ],
  }),
  antigravity: (id, name = "read") => ({
    userAgent: "antigravity", model: GEMINI, project: "synthetic-project",
    request: {
      contents: [
        { role: "user", parts: [{ text: "inspect" }] },
        { role: "model", parts: [{ functionCall: { id, name, args: {} } }] },
        { role: "user", parts: [{ functionResponse: { id, name, response: { result: `${name}-ok` } } }] },
      ],
    },
  }),
};

// Replay one turn and return the signature sent for the first functionCall.
async function replayedSignature(id, { format = "openai", account = "acct-A", session = "sess-1" } = {}) {
  upstream(json(envelope([{ text: "ok" }])));
  const result = await run({ body: turn2[format](id), format, account, session });
  expect(result.success).toBe(true);
  return sentCalls()[0].thoughtSignature;
}

async function streamCapture({ format = "openai", account = "acct-A", session = "sess-1", parts }) {
  upstream(sse(envelope(parts)));
  const result = await run({ body: turn1[format](true), format, account, session });
  expect(result.success).toBe(true);
  const text = await result.response.text();
  await settle();
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbLocked = false;
  store.clearThoughtSignatureMemory();
  mocks.agy = new AntigravityExecutor();
  mocks.queue.length = 0;
  mocks.fetch.mockImplementation(async (url) => {
    if (!isGeneration(url)) return json({ totalTokens: 5 });
    const next = mocks.queue.shift();
    if (!next) throw new Error(`unscripted upstream call ${url}`);
    return next;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("#2034: a streamed Antigravity signature stays with its account", () => {
  it.each(["openai", "claude"])("(%s) is never replayed to another account, warm or cold, same or new session", async (format) => {
    const a = uid("stream-iso");
    await streamCapture({ format, parts: [{ thoughtSignature: SIG_A }, call("read", a)] });

    for (const session of ["sess-1", "sess-2"]) {
      for (const replayFormat of [format, "antigravity"]) {
        expect(await replayedSignature(a, { format: replayFormat, account: "acct-B", session })).not.toBe(SIG_A);
        expect(JSON.stringify(lastSent())).not.toContain(SIG_A);
      }
    }
    // Warm session API and keyed bare fallbacks do not see the account-bound row either.
    expect(store.getGeminiThoughtSignatureSync(a, null, GEMINI)).toBeNull();
    expect(store.getGeminiThoughtSignatureSync(a, "sess-2", GEMINI)).toBeNull();
    expect(store.getKeyedThoughtSignature(`acct-B:${a}`)).toBeNull();

    // Cold cache: the persisted rows are checked with the same provenance rules.
    store.clearThoughtSignatureMemory();
    expect(await store.getGeminiThoughtSignature(a, "sess-2", GEMINI)).toBeNull();
    for (const session of ["sess-1", "sess-2"]) {
      expect(await replayedSignature(a, { format, account: "acct-B", session })).not.toBe(SIG_A);
      expect(JSON.stringify(lastSent())).not.toContain(SIG_A);
    }

    // The capturing account still replays it after the cold read.
    store.clearThoughtSignatureMemory();
    expect(await replayedSignature(a, { format, account: "acct-A", session: "sess-1" })).toBe(SIG_A);
  });

  it("keeps same-account replay on every endpoint and the embedded transport round trip", async () => {
    const a = uid("stream-own");
    const text = await streamCapture({ parts: [{ thoughtSignature: SIG_A }, call("read", a)] });
    const transportId = text.match(/"id":"(agsig1_[A-Za-z0-9_-]+)"/)[1];
    expect(decodeToolCallId(transportId)).toEqual({ id: a, signature: SIG_A });

    for (const format of ["openai", "claude", "antigravity"]) {
      expect(await replayedSignature(a, { format })).toBe(SIG_A);
    }
    // Same account, a new client session: the row records this account (owner provenance).
    expect(await replayedSignature(a, { session: "sess-9" })).toBe(SIG_A);

    // The client-held transport id carries its own signature, store or not.
    store.clearThoughtSignatureMemory();
    await store.clearThoughtSignatures();
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: turn2.openai(transportId) });
    expect(sentCalls()[0]).toMatchObject({ functionCall: { id: a }, thoughtSignature: SIG_A });
  });

  it.each(["openai", "claude"])("(%s) a capture made while the adapter open fails is still replayed cold, to its account only", async (format) => {
    // The first capture of a process persists asynchronously; when that open fails
    // (another process migrating the same file) the row must not be lost.
    await store.getGeminiThoughtSignature("warm-up", null, GEMINI);
    const a = uid("locked-open");
    mocks.dbLocked = true;
    await streamCapture({ format, parts: [{ thoughtSignature: SIG_A }, call("read", a)] });
    mocks.dbLocked = false;

    store.clearThoughtSignatureMemory();
    expect(await replayedSignature(a, { format, account: "acct-B", session: "sess-1" })).not.toBe(SIG_A);
    expect(JSON.stringify(lastSent())).not.toContain(SIG_A);
    store.clearThoughtSignatureMemory();
    expect(await replayedSignature(a, { format, account: "acct-A", session: "sess-1" })).toBe(SIG_A);
    // The cold read retried the write: SQLite itself now holds the account-bound alias.
    const db = await (await import("../../src/lib/db/driver.js")).getAdapter();
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", ["gemini_thought_signatures", a]);
    expect(JSON.parse(row.value)).toMatchObject({ signature: SIG_A, account: "acct-A" });
    expect(await store.getGeminiThoughtSignature(a, "sess-1", GEMINI)).toBeNull();
  });

  it("an account captured in a shared session does not leak to the next account of that session", async () => {
    const a = uid("combo");
    // Same client session across a combo: A answers turn 1, B gets turn 2.
    await streamCapture({ parts: [{ thoughtSignature: SIG_A }, call("read", a)], session: "combo-1" });
    expect(await replayedSignature(a, { account: "acct-B", session: "combo-1", format: "antigravity" })).not.toBe(SIG_A);
    expect(await replayedSignature(a, { account: "acct-B", session: "combo-1" })).not.toBe(SIG_A);
    expect(await replayedSignature(a, { account: "acct-A", session: "combo-1" })).toBe(SIG_A);
  });
});

describe("#2034: rows of unknown or foreign provenance are never borrowed by the executor", () => {
  const nativeReplay = async (id, { account = "acct-B", session = "sess-new" } = {}) => {
    const body = turn2.antigravity(id);
    body.request.sessionId = session;
    upstream(sse(envelope([{ text: "ok" }])));
    const result = await run({ body, format: "antigravity", account, session: null });
    await result.response.text();
    return sentCalls()[0].thoughtSignature;
  };

  it("ignores a legacy global bare row and another session's row, warm and cold", async () => {
    const legacy = uid("legacy");
    const foreign = uid("foreign");
    store.storeGeminiThoughtSignature(legacy, SIG_LEGACY, null, GEMINI);
    store.storeGeminiThoughtSignature(foreign, SIG_B, "someone-else", GEMINI);
    await settle();

    for (const cold of [false, true]) {
      if (cold) store.clearThoughtSignatureMemory();
      expect(await nativeReplay(legacy)).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
      expect(await nativeReplay(foreign)).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
      expect(await store.getProvenThoughtSignature(legacy, { accountId: "acct-B", sessionId: "antigravity:sess-new", model: GEMINI })).toBeNull();
      expect(store.getProvenThoughtSignatureSync(foreign, { accountId: "acct-B", sessionId: "antigravity:sess-new", model: GEMINI })).toBeNull();
    }
    // The global session API contract for direct Gemini routes is unchanged.
    expect(await store.getGeminiThoughtSignature(legacy, "any", GEMINI)).toBe(SIG_LEGACY);
  });

  it.each(["openai", "claude"])("(%s) rejects legacy global aliases before executor validation, warm and cold", async (format) => {
    const id = uid("legacy-gateway");
    store.storeGeminiThoughtSignature(id, SIG_LEGACY, null, GEMINI);
    await settle();
    for (const cold of [false, true]) {
      if (cold) store.clearThoughtSignatureMemory();
      expect(await replayedSignature(id, { format, account: "acct-B", session: "new-session" })).not.toBe(SIG_LEGACY);
      expect(JSON.stringify(lastSent())).not.toContain(SIG_LEGACY);
    }
    // Direct Gemini callers retain their existing legacy contract.
    expect(await store.getGeminiThoughtSignature(id, null, GEMINI)).toBe(SIG_LEGACY);
  });

  it("does not let an unknown account borrow an account-bound row, and accepts exact-session legacy rows", async () => {
    const a = uid("unknown-reader");
    store.storeGeminiThoughtSignature(a, SIG_A, "antigravity:s1", GEMINI, "acct-A");
    expect(store.getProvenThoughtSignatureSync(a, { accountId: null, sessionId: "antigravity:s1", model: GEMINI })).toBeNull();
    expect(store.getProvenThoughtSignatureSync(a, { accountId: "unknown", sessionId: "antigravity:s1", model: GEMINI })).toBeNull();
    expect(store.getProvenThoughtSignatureSync(a, { accountId: "acct-A", sessionId: null, model: GEMINI })).toBe(SIG_A);
    expect(store.getProvenThoughtSignatureSync(a, { accountId: "acct-A", sessionId: null, model: "claude-sonnet-4-6" })).toBeNull();

    // A pre-provenance row under the exact client session still replays in that session.
    const legacySession = uid("legacy-session");
    store.storeGeminiThoughtSignature(legacySession, SIG_LEGACY, "antigravity:s2", GEMINI);
    expect(await nativeReplay(legacySession, { account: "acct-A", session: "s2" })).toBe(SIG_LEGACY);
    expect(await nativeReplay(legacySession, { account: "acct-A", session: "s3" })).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
  });

  it("drops an account-bound signature only from foreign readers, not from an explicit native part", async () => {
    const a = uid("explicit");
    store.storeGeminiThoughtSignature(a, SIG_A, "antigravity:s1", GEMINI, "acct-A");
    const body = turn2.antigravity(a);
    body.request.contents[1].parts[0].thoughtSignature = SIG_B;
    upstream(sse(envelope([{ text: "ok" }])));
    await (await run({ body, format: "antigravity", account: "acct-B", session: null })).response.text();
    expect(sentCalls()[0].thoughtSignature).toBe(SIG_B);
  });
});

describe("#2034: generated tool-call ids do not collide in the same millisecond", () => {
  const FROZEN = 1_790_000_000_000;
  const freeze = () => vi.spyOn(Date, "now").mockReturnValue(FROZEN);

  const toolIds = async (result, format) => {
    if (result.response.headers.get("content-type")?.includes("event-stream")) {
      const text = await result.response.text();
      return [...text.matchAll(/"(?:id)":"((?:agsig1_|read_|call_read_|toolu_)[A-Za-z0-9_-]*)"/g)].map((m) => m[1]);
    }
    const out = await result.response.json();
    return format === "claude" ?
      out.content.filter((b) => b.type === "tool_use").map((b) => b.id) :
      out.choices[0].message.tool_calls.map((tc) => tc.id);
  };

  it.each([
    ["nonstream JSON", false, false],
    ["streaming", true, false],
    ["forced SSE to JSON", false, true],
  ])("%s: simultaneous id-less calls on two accounts get distinct ids and keep their own signature", async (_label, stream, forceStream) => {
    freeze();
    const respond = (sig) => (stream || forceStream ? sse : json)(envelope([{ thoughtSignature: sig }, call("read")]));
    upstream(respond(SIG_A), respond(SIG_B));
    const [first, second] = await Promise.all([
      run({ body: turn1.openai(stream), account: "acct-A", session: "s-a", forceStream }),
      run({ body: turn1.openai(stream), account: "acct-B", session: "s-b", forceStream }),
    ]);
    const [idsA, idsB] = [await toolIds(first, "openai"), await toolIds(second, "openai")];
    await settle();
    const rawA = decodeToolCallId(idsA[0]);
    const rawB = decodeToolCallId(idsB[0]);
    expect(rawA.signature).toBe(SIG_A);
    expect(rawB.signature).toBe(SIG_B);
    expect(rawA.id).not.toBe(rawB.id);
    expect(rawA.id).not.toContain(String(FROZEN));
    for (const id of [rawA.id, rawB.id]) expect(id).toMatch(/^(call_)?read_\d{20}_0$/);

    // Each account replays only its own signature for its own id.
    expect(await replayedSignature(rawA.id, { account: "acct-A", session: "s-a" })).toBe(SIG_A);
    expect(await replayedSignature(rawB.id, { account: "acct-B", session: "s-b" })).toBe(SIG_B);
    expect(await replayedSignature(rawA.id, { account: "acct-B", session: "s-b" })).not.toBe(SIG_A);
  });

  it("two responses for one account in the same millisecond do not overwrite each other", async () => {
    freeze();
    upstream(json(envelope([{ thoughtSignature: SIG_A }, call("read")])), json(envelope([{ thoughtSignature: SIG_B }, call("read")])));
    const results = await Promise.all([run({ body: turn1.openai(false) }), run({ body: turn1.openai(false) })]);
    const [[first], [second]] = await Promise.all(results.map((r) => toolIds(r, "openai")));
    const [a, b] = [decodeToolCallId(first), decodeToolCallId(second)];
    expect(a.id).not.toBe(b.id);
    expect(store.getAccountThoughtSignatureSync(a.id, "acct-A", GEMINI)).toBe(a.signature);
    expect(store.getAccountThoughtSignatureSync(b.id, "acct-A", GEMINI)).toBe(b.signature);
  });

  it("keeps valid upstream ids and the Anthropic tool_use alphabet", async () => {
    freeze();
    const upstreamId = uid("toolu_upstream");
    upstream(json(envelope([call("read", upstreamId), call("list"), call("read")])));
    const result = await run({ body: turn1.claude(false), format: "claude" });
    const ids = await toolIds(result, "claude");
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(upstreamId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(ANTHROPIC_ID);

    upstream(sse(envelope([call("read", upstreamId), call("list")])));
    const streamed = await run({ body: turn1.claude(true), format: "claude" });
    const text = await streamed.response.text();
    const streamedIds = [...text.matchAll(/"type":"tool_use","id":"([^"]+)"/g)].map((m) => m[1]);
    expect(streamedIds[0]).toBe(upstreamId);
    expect(streamedIds).toHaveLength(2);
    for (const id of streamedIds) expect(id).toMatch(ANTHROPIC_ID);
  });

  it("an encoded generated id stays inside the Anthropic alphabet for an unusual tool name", () => {
    const id = encodeToolCallIdWithSignature("ns.read tool_12345678901234567890_0", null);
    expect(id).toMatch(ANTHROPIC_ID);
  });
});

describe("#2034: tool-result media ordering (OmniRoute 21439 groups media before function responses)", () => {
  const PNG = "iVBORw0KGgo=";
  const GIF = "R0lGODlh";
  const history = (results) => ({
    model: GEMINI, stream: false, max_tokens: 256, tools: TOOLS,
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: null, tool_calls: results.map(([id, name]) => ({ id, type: "function", function: { name, arguments: "{}" } })) },
      ...results.map(([id, , content]) => ({ role: "tool", tool_call_id: id, content })),
    ],
  });

  it("OpenAI: puts every media part before the function responses, in call order, and drops nothing", async () => {
    const [a, b, c] = [uid("media-a"), uid("media-b"), uid("media-c")];
    upstream(json(envelope([{ text: "ok" }])));
    await run({
      body: history([
        [a, "read", [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }, { type: "text", text: "first" }]],
        [b, "list", JSON.stringify({ result: { files: ["x"] } })],
        [c, "read", [{ type: "text", text: "third" }, { type: "image_url", image_url: { url: `data:image/gif;base64,${GIF}` } }]],
      ]),
    });
    const turn = lastSent().request.contents.at(-1);
    expect(turn.role).toBe("user");
    expect(turn.parts.map((p) => (p.inlineData ? `media:${p.inlineData.mimeType}` : `fr:${p.functionResponse.id}`))).toEqual([
      "media:image/png", "media:image/gif", `fr:${a}`, `fr:${b}`, `fr:${c}`,
    ]);
    expect(turn.parts[0].inlineData.data).toBe(PNG);
    expect(turn.parts[1].inlineData.data).toBe(GIF);
    // Upstream #5529: one `result` envelope; an existing envelope is not wrapped again.
    expect(turn.parts.slice(2).map((p) => p.functionResponse.response)).toEqual([
      { result: "first" }, { result: { files: ["x"] } }, { result: "third" },
    ]);
  });

  it("Anthropic: tool_result media also precedes the function responses without losing text", async () => {
    const [a, b] = [uid("cmedia-a"), uid("cmedia-b")];
    upstream(json(envelope([{ text: "ok" }])));
    await run({
      format: "claude",
      body: {
        model: GEMINI, max_tokens: 256, stream: false, tools: CLAUDE_TOOLS,
        messages: [
          { role: "user", content: "inspect" },
          { role: "assistant", content: [{ type: "tool_use", id: a, name: "read", input: {} }, { type: "tool_use", id: b, name: "list", input: {} }] },
          { role: "user", content: [
            { type: "tool_result", tool_use_id: a, content: [{ type: "text", text: "first" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] },
            { type: "tool_result", tool_use_id: b, content: "second" },
          ] },
        ],
      },
    });
    const parts = sentParts();
    const turn = lastSent().request.contents.find((c) => c.parts.some((p) => p.functionResponse));
    const fr = turn.parts.filter((p) => p.functionResponse);
    expect(fr.map((p) => p.functionResponse.id)).toEqual([a, b]);
    expect(turn.parts.findIndex((p) => p.functionResponse)).toBe(turn.parts.length - fr.length);
    expect(parts.some((p) => p.inlineData?.data === PNG)).toBe(true);
    expect(JSON.stringify(fr[0].functionResponse.response)).toContain("first");
    expect(JSON.stringify(fr[1].functionResponse.response)).toContain("second");
  });
});
