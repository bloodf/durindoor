/**
 * Microsoft 365 Copilot: image generation, the turn composer (citations, reasoning summaries),
 * typed licence and throttle errors, temporary chats, model tone profiles, automatic tier
 * selection and the dashboard sign-in dialog (#2034).
 *
 * Everything here is closed: a temporary DATA_DIR, synthetic accounts and tokens, a fake `fetch`
 * for the Microsoft identity endpoint and the Designer artifact host, and a fake Chathub WebSocket.
 * No provider is contacted, and no real token, cookie or image appears in this file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let api;

const NATIVE = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const DESIGNER_SCOPE = "https://designerappservice.officeapps.live.com/.default";
const ARTIFACT_URL = "https://designerapp.officeapps.live.com/designerapp/document.ashx?fileToken=synthetic-1";
const WORK = { oid: "11111111-1111-4111-8111-111111111111", tid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "ada@contoso.example", name: "Ada" };
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);

/** Unsigned JWT-shaped token carrying the claims the code under test reads. */
function accessJwt(account, { exp = Math.floor(Date.now() / 1000) + 3600, tag = "t" } = {}) {
  const claims = { oid: account.oid, tid: account.tid, preferred_username: account.email, name: account.name, exp, jti: tag };
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
}
const nativeCredentials = (extra = {}) => ({
  connectionId: extra.connectionId ?? "conn-native",
  accessToken: accessJwt(WORK, { tag: "chat" }),
  refreshToken: "rt-native",
  providerSpecificData: { authMethod: "oauth", oid: WORK.oid, tid: WORK.tid, chathubPath: `${WORK.oid}@${WORK.tid}`, ...extra.psd },
});
const pastedCredentials = (psd = {}) => ({ apiKey: "access_token=pasted-token; chathubPath=user@tenant", providerSpecificData: psd });

/** Fake network: identity endpoint and Designer artifact host. Anything else is refused. */
const calls = [];
let tokenHandler;
let artifactHandler;
const fakeFetch = vi.fn(async (url, init = {}) => {
  const target = String(url);
  const headers = new Headers(init.headers);
  calls.push({ url: target, redirect: init.redirect, authorization: headers.get("authorization"), body: init.body ? String(init.body) : "" });
  if (target.startsWith("https://login.microsoftonline.com/")) return tokenHandler(target, Object.fromEntries(new URLSearchParams(String(init.body))));
  if (target.startsWith("https://designerapp.officeapps.live.com/")) return artifactHandler(target, init);
  throw new Error(`unexpected fetch ${target}`);
});
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Fake Chathub socket. Each chat invocation consumes the next queued list of frames (then a completion). */
const sockets = [];
const scripts = [];
const script = (...frames) => scripts.push(frames);
class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.handlers = {};
    this.invocations = [];
    sockets.push(this);
    queueMicrotask(() => this.emit("open"));
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...args) { this.handlers[name]?.(...args); }
  close() {}
  send(data) {
    let frame;
    try { frame = JSON.parse(String(data).replace(/\x1e$/, "")); } catch { return; }
    if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
    if (frame.target === "chat") {
      this.invocations.push(frame.arguments[0]);
      const frames = scripts.shift() ?? [update({ text: "(no reply queued)" })];
      const terminal = frames.some((item) => item.type === 3) ? [] : [{ type: 3, invocationId: "0" }];
      queueMicrotask(() => this.emit("message", Buffer.from([...frames, ...terminal].map((item) => `${JSON.stringify(item)}\x1e`).join(""))));
    }
  }
  get query() { return new URL(this.url).searchParams; }
  get turn() { return this.invocations[0]; }
}
const update = (...messages) => ({ type: 1, target: "update", arguments: [{ messages: messages.map((message) => ({ author: "bot", ...message })) }] });
const finalResult = (result, messages = []) => ({ type: 2, invocationId: "0", item: { messages, result } });

/** Copilot citation marker and its `references` entry. */
const cite = (...ids) => `cite${ids.join("")}`;
const reference = (id, url, title) => ({ targetLink: url, displayData: { content: JSON.stringify({ Title: title, metadata: { referenceId: id } }) } });

const json = (url, method, body) => new Request(`https://durindoor.local${url}`, {
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const MODEL = "m365copilot/copilot-m365";
const openai = (messages, extra = {}) => api.handleChat(json("/v1/chat/completions", "POST", { model: MODEL, messages, ...extra }));
const anthropic = (messages, extra = {}) => api.handleChat(json("/v1/messages", "POST", { model: MODEL, max_tokens: 256, messages, ...extra }));
const run = (credentials, extra = {}) => new api.Executor().execute({
  model: "copilot-m365",
  stream: false,
  body: { messages: [{ role: "user", content: "hello" }] },
  credentials,
  ...extra,
});

async function seedNative(extra = {}) {
  return api.createProviderConnection({
    provider: "copilot-m365-web",
    authType: "oauth",
    name: WORK.name,
    email: WORK.email,
    accessToken: accessJwt(WORK, { tag: "seed" }),
    refreshToken: extra.refreshToken ?? "rt-seed",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    providerSpecificData: { authMethod: "oauth", oid: WORK.oid, tid: WORK.tid, chathubPath: `${WORK.oid}@${WORK.tid}` },
    testStatus: "active",
  });
}
async function seedPasted() {
  return api.createProviderConnection({
    provider: "copilot-m365-web",
    authType: "cookie",
    name: "pasted",
    apiKey: "access_token=pasted-token; chathubPath=user@tenant",
    testStatus: "active",
  });
}
async function clearConnections() {
  for (const connection of await api.getProviderConnections()) await api.deleteProviderConnection(connection.id);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-m365-remaining-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } }),
    },
  }));
  const models = await import("@/models/index.js");
  const dbIndex = await import("@/lib/db/index.js");
  await dbIndex.initDb();
  const m365 = await import("../../open-sse/executors/copilot-m365-web.js");
  const conversations = await import("../../open-sse/executors/copilot-m365-conversations.js");
  const generation = await import("../../open-sse/executors/copilot-m365-image-generation.js");
  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  const flows = await import("@/lib/oauth/flowStore.js");
  const dedup = await import("../../open-sse/services/tokenRefresh/dedup.js");
  api = {
    ...models,
    oauth: await import("../../src/app/api/oauth/[provider]/[action]/route.js"),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
    handleImageGeneration: (await import("../../src/sse/handlers/imageGeneration.js")).handleImageGeneration,
    connection: await import("../../open-sse/executors/copilot-m365-connection.js"),
    composer: await import("../../open-sse/executors/copilot-m365-composer.js"),
    profile: await import("../../open-sse/executors/copilot-m365-profile.js"),
    generation,
    Executor: m365.CopilotM365WebExecutor,
    store: conversations,
    flows,
    dedup,
    restores: [
      proxyFetch.__setOriginalFetchForTesting(fakeFetch),
      m365.__setCopilotM365WebSocketForTesting(FakeSocket),
    ],
  };
}, 90_000);

afterAll(async () => {
  api?.restores?.forEach((restore) => restore());
  vi.doUnmock("next/server");
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  await clearConnections();
  api.flows.clearOAuthFlowsForTests();
  api.store.__resetM365ConversationsForTesting();
  api.generation.__resetM365ArtifactTokensForTesting();
  api.dedup.__clearRefreshDedupCacheForTesting();
  sockets.length = 0;
  scripts.length = 0;
  calls.length = 0;
  fakeFetch.mockClear();
  tokenHandler = () => jsonResponse({ error: "unexpected" }, 500);
  artifactHandler = () => new Response("unexpected", { status: 500 });
});

describe("M365 image generation", () => {
  const drawn = (status = 2) => update({
    messageType: "GenerateGraphicArt",
    text: "",
    contentGenerationProgressList: [{ fileToken: "synthetic-1", status, ImageReferenceUrls: [ARTIFACT_URL] }],
  });
  const generate = (body = {}) => api.handleImageGeneration(json("/v1/images/generations", "POST", {
    model: "m365copilot/copilot-m365-image",
    prompt: "a stone gate in a forest",
    ...body,
  }));

  it("draws through one temporary image turn and downloads the artifact with a Designer token", async () => {
    const saved = await seedNative({ refreshToken: "rt-seed" });
    script(update({ text: "Here is your image." }), drawn(1), drawn(2), finalResult({ value: "Success" }));
    tokenHandler = (_url, form) => jsonResponse({ token_type: "Bearer", access_token: "designer-token", refresh_token: "rt-rotated", expires_in: 3600, scope: form.scope });
    artifactHandler = () => new Response(PNG_BYTES, { status: 200, headers: { "Content-Type": "application/octet-stream" } });

    const res = await generate({ size: "1792x1024" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(Buffer.from(body.data[0].b64_json, "base64").equals(PNG_BYTES)).toBe(true);

    // The turn opts into image generation and is a temporary chat.
    expect(sockets).toHaveLength(1);
    expect(sockets[0].query.get("disableMemory")).toBe("1");
    expect(sockets[0].turn.allowedMessageTypes).toContain("GenerateGraphicArt");
    expect(sockets[0].turn.optionsSets).toEqual(expect.arrayContaining(["cwc_flux_image", "flux_v3_image_gen_enable_dimensions"]));
    expect(sockets[0].turn.message.text).toContain("landscape");

    // The Designer token is minted at the account's own tenant with the artifact scope, and only
    // the Designer host receives it; neither request follows a redirect.
    const [mint, download] = calls;
    expect(mint.url).toBe(`https://login.microsoftonline.com/${WORK.tid}/oauth2/v2.0/token`);
    expect(new URLSearchParams(mint.body).get("scope")).toContain(DESIGNER_SCOPE);
    expect(new URLSearchParams(mint.body).get("refresh_token")).toBe("rt-seed");
    expect(mint.redirect).toBe("manual");
    expect(download).toMatchObject({ url: ARTIFACT_URL, authorization: "Bearer designer-token", redirect: "manual" });
    expect(calls).toHaveLength(2);

    // The rotated refresh token is persisted on the connection.
    const stored = (await api.getProviderConnections()).find((row) => row.id === saved.id);
    expect(stored.refreshToken).toBe("rt-rotated");
  });

  it("refuses a pasted session before spending the image budget", async () => {
    await seedPasted();
    const res = await generate();
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("native sign-in");
    expect(sockets).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("maps a no-image quota answer to 429 and never mints a token", async () => {
    await seedNative();
    script(update({ text: "Sorry, I can't generate any more images today. Try again tomorrow." }));
    const res = await generate();
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("never sends the Designer token to another origin", async () => {
    tokenHandler = () => jsonResponse({ token_type: "Bearer", access_token: "designer-token", expires_in: 3600 });
    artifactHandler = () => new Response(null, { status: 302, headers: { Location: "https://collector.example/steal" } });
    script(drawn(2));
    const request = { credentials: nativeCredentials(), prompt: "x", orientation: null };
    await expect(api.generation.generateM365Images(request)).rejects.toMatchObject({ status: 502, code: "m365_image_download_failed" });
    expect(calls.map((call) => new URL(call.url).hostname)).not.toContain("collector.example");

    // A foreign artifact URL announced by the turn is never fetched with the token.
    calls.length = 0;
    api.generation.__resetM365ArtifactTokensForTesting();
    script(update({ text: "", contentGenerationProgressList: [{ status: 2, ImageReferenceUrls: ["https://collector.example/a.png"] }] }));
    await expect(api.generation.generateM365Images(request)).rejects.toMatchObject({ code: "m365_image_download_failed" });
    expect(calls.filter((call) => call.authorization === "Bearer designer-token")).toEqual([]);
  });

  it("reads orientation from the size and classifies refusals", () => {
    expect(api.generation.m365OrientationForSize("1024x1024")).toBe("square");
    expect(api.generation.m365OrientationForSize("1024x1792")).toBe("portrait");
    expect(api.generation.m365OrientationForSize("auto")).toBeNull();
    expect(api.generation.classifyM365ImageFailure("I can't create that image because it is against our content policy.")).toBe("content_filtered");
    expect(api.generation.classifyM365ImageFailure("I'm having trouble generating the image. Try again later.")).toBe("capacity");
    expect(api.generation.classifyM365ImageFailure("A lovely caption")).toBe("no_image");
  });
});

describe("M365 turn composer: citations", () => {
  const citedTurn = () => {
    const text = `DurinDoor is a gateway${cite("ref-1")} with a stone gate${cite("ref-1", "ref-2")}.`;
    script({
      type: 1,
      target: "update",
      arguments: [{
        messages: [{ author: "bot", messageId: "m1", text, references: {
          a: reference("ref-1", "https://docs.example/gateway", "Gateway docs"),
          b: reference("ref-2", "https://docs.example/gate", "Gate docs"),
        } }],
      }],
    });
  };

  it("resolves markers into numbered links and url_citation annotations in OpenAI JSON", async () => {
    await seedPasted();
    citedTurn();
    const res = await openai([{ role: "user", content: "what is it?" }], { stream: false });
    expect(res.status).toBe(200);
    const message = (await res.json()).choices[0].message;
    expect(message.content).toBe(
      "DurinDoor is a gateway [1](https://docs.example/gateway) with a stone gate [1](https://docs.example/gateway) [2](https://docs.example/gate).",
    );
    expect(message.content).not.toMatch(/[-]/);
    expect(message.annotations).toHaveLength(3);
    for (const annotation of message.annotations) {
      const { url, start_index: start, end_index: end } = annotation.url_citation;
      expect(annotation.type).toBe("url_citation");
      expect(message.content.slice(start, end)).toContain(url);
    }
    expect(message.annotations[2].url_citation).toMatchObject({ url: "https://docs.example/gate", title: "Gate docs" });
  });

  it("streams annotations with the text they cover", async () => {
    await seedPasted();
    citedTurn();
    const res = await openai([{ role: "user", content: "what is it?" }], { stream: true });
    const text = await res.text();
    expect(text).toContain('"annotations":[{"type":"url_citation"');
    expect(text).toContain("[2](https://docs.example/gate)");
    expect(text).not.toMatch(/[-]/);
  });

  it("keeps the cited links in Anthropic output", async () => {
    await seedPasted();
    citedTurn();
    const res = await anthropic([{ role: "user", content: "what is it?" }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    const text = body.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    expect(text).toContain("[1](https://docs.example/gateway)");
    expect(text).toContain("[2](https://docs.example/gate)");
    expect(text).not.toMatch(/[-]/);
  });

  it("holds a citation until its source arrives and drops an unknown one at the end", () => {
    const composer = new api.composer.M365TurnComposer();
    const first = composer.push(update({ messageId: "m", text: `Fact${cite("late")} more` }));
    expect(first.delta).toBe("Fact");
    const second = composer.push({ type: 1, target: "update", arguments: [{ references: { x: reference("late", "https://late.example/", "Late") } }] });
    expect(second.delta).toBe(" [1](https://late.example/) more");
    expect(second.annotations).toHaveLength(1);
    const orphan = new api.composer.M365TurnComposer();
    orphan.push(update({ messageId: "m", text: `Claim${cite("missing")}.` }));
    orphan.push({ type: 3 });
    expect(orphan.text).toBe("Claim.");
  });
});

describe("M365 turn composer: reasoning summary", () => {
  const reasoningTurn = () => script(
    update({ messageId: "r1", contentOrigin: "ChainOfThoughtSummary", text: "Weighing the gate options" }),
    update({ messageId: "a1", text: "Use the north gate." }),
  );

  it("returns the summary as reasoning_content, apart from the answer", async () => {
    await seedPasted();
    reasoningTurn();
    const res = await openai([{ role: "user", content: "which gate?" }], { stream: false });
    const message = (await res.json()).choices[0].message;
    expect(message.content).toBe("Use the north gate.");
    expect(message.reasoning_content).toBe("Weighing the gate options");
  });

  it("streams the summary before the answer and becomes an Anthropic thinking block", async () => {
    await seedPasted();
    reasoningTurn();
    const streamed = await (await openai([{ role: "user", content: "which gate?" }], { stream: true })).text();
    expect(streamed.indexOf('"reasoning_content":"Weighing the gate options"')).toBeGreaterThan(-1);
    expect(streamed.indexOf('"reasoning_content"')).toBeLessThan(streamed.indexOf("Use the north gate."));

    reasoningTurn();
    const body = await (await anthropic([{ role: "user", content: "which gate?" }])).json();
    expect(body.content.find((block) => block.type === "thinking")?.thinking).toBe("Weighing the gate options");
    expect(body.content.find((block) => block.type === "text")?.text).toBe("Use the north gate.");
  });
});

describe("M365 typed licence and throttle errors", () => {
  it.each([
    [{ value: "Success", errorCode: "ClaudeUnavailableForLicense" }, 403, "m365_model_not_licensed", { m365_error_code: "ClaudeUnavailableForLicense", param: "copilot-m365" }],
    [{ value: "InvalidCopilotLicense" }, 403, "m365_account_not_licensed", { m365_error_code: "InvalidCopilotLicense" }],
    [{ value: "Throttled", retryAfter: 30 }, 429, "m365_throttled", {}],
    [{ value: "OutOfCredits", errorCode: "ReasoningTurnExhausted" }, 429, "reasoning_turns_exhausted", {}],
    [{ value: "OutOfCredits", message: "You've used all of your priority access for today." }, 429, "priority_access_exhausted", { param: "day" }],
    [{ value: "Disengaged" }, 400, "provider_safety_rejection", {}],
  ])("maps %j to %i %s", async (result, status, code, extra) => {
    script(update({ text: "partial" }), finalResult(result));
    const res = (await run(pastedCredentials())).response;
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toMatchObject({ code, ...extra });
    // Only validated codes cross the boundary, never upstream text.
    expect(JSON.stringify(body)).not.toContain("priority access for today");
    if (status === 429) expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("uses the bounded Retry-After of a throttled turn", async () => {
    script(finalResult({ value: "Throttled", retryAfter: 30 }));
    const res = (await run(pastedCredentials())).response;
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("answers a streamed licence refusal with its own status, not a 200 stream", async () => {
    script(finalResult({ value: "Success", errorCode: "PremiumModelUnavailableForLicense" }));
    const res = (await run(pastedCredentials(), { stream: true })).response;
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("m365_model_not_licensed");
  });

  it("maps a throttled WebSocket upgrade to 429", async () => {
    class RefusedSocket extends FakeSocket {
      constructor(url, options) {
        super(url, options);
        this.emit = FakeSocket.prototype.emit;
        queueMicrotask(() => this.handlers["unexpected-response"]?.({}, { statusCode: 429, headers: { "retry-after": "12" }, resume() {} }));
      }
      send() {}
    }
    const { __setCopilotM365WebSocketForTesting } = await import("../../open-sse/executors/copilot-m365-web.js");
    const restore = __setCopilotM365WebSocketForTesting(RefusedSocket);
    try {
      const res = (await run(pastedCredentials())).response;
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("12");
    } finally {
      restore();
    }
  });

  it("falls back to the next account after a licence refusal through the gateway", async () => {
    await seedPasted();
    await seedNative();
    script(finalResult({ value: "Success", errorCode: "ClaudeUnavailableForLicense" }));
    script(update({ text: "served" }));
    const res = await openai([{ role: "user", content: "hi" }], { stream: false });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("served");
    expect(sockets).toHaveLength(2);
  });
});

describe("M365 temporary chats and tone profiles", () => {
  it("marks every turn as a temporary chat unless the connection opts out", async () => {
    script(update({ text: "a" }));
    await run(pastedCredentials());
    expect(sockets[0].query.get("disableMemory")).toBe("1");
    script(update({ text: "b" }));
    await run(pastedCredentials({ temporaryChat: false }));
    expect(sockets[1].query.has("disableMemory")).toBe(false);
  });

  it("keeps temporary and history chats in separate continuations", async () => {
    const credentials = { ...pastedCredentials(), connectionId: "conn-temp" };
    script(update({ text: "first" }));
    await run(credentials, { body: { messages: [{ role: "user", content: "one" }] } });
    script(update({ text: "second" }));
    const next = [{ role: "user", content: "one" }, { role: "assistant", content: "first" }, { role: "user", content: "two" }];
    await run({ ...credentials, providerSpecificData: { temporaryChat: false } }, { body: { messages: next } });
    expect(sockets[1].turn.isStartOfSession).toBe(true);
  });

  it("selects the documented tone and route for a model id", async () => {
    script(update({ text: "ok" }));
    await run(pastedCredentials(), { model: "claude-sonnet" });
    expect(sockets[0].turn.tone).toBe("Claude_Sonnet");
    expect(sockets[0].query.get("scenario")).toBe("OfficeWebIncludedCopilot");
    script(update({ text: "ok" }));
    await run(pastedCredentials(), { model: "copilot-m365" });
    expect(sockets[1].turn.tone).toBe("");
    expect(api.profile.resolveM365Profile({ model: "m365/claude-opus", tone: "Custom" })).toMatchObject({ tone: "Custom", licenseType: "Premium" });
  });

  it("routes a documented model id through the gateway with its tone", async () => {
    await seedPasted();
    script(update({ text: "ok" }));
    const res = await api.handleChat(json("/v1/chat/completions", "POST", { model: "m365copilot/claude-sonnet", stream: false, messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(200);
    expect(sockets[0].turn.tone).toBe("Claude_Sonnet");
  });
});

describe("M365 automatic tier selection", () => {
  it("routes a native work account as enterprise without a configured tier", async () => {
    script(update({ text: "ok" }));
    await run(nativeCredentials());
    expect(sockets[0].query.get("agent")).toBe("work");
    expect(sockets[0].query.get("scenario")).toBe("officeweb");
    expect(sockets[0].query.get("licenseType")).toBe("Premium");
    expect(api.connection.resolveM365Tier(nativeCredentials())).toEqual({ tier: "enterprise", tierSource: "auto" });
  });

  it("keeps an explicit tier, an explicit route and pasted sessions as they were", () => {
    const { resolveM365Tier, resolveConnectionParams } = api.connection;
    expect(resolveM365Tier(nativeCredentials({ psd: { tier: "edu" } }))).toEqual({ tier: "edu", tierSource: "explicit" });
    expect(resolveM365Tier(nativeCredentials({ psd: { tier: "individual" } }))).toEqual({ tier: undefined, tierSource: "explicit" });
    expect(resolveM365Tier(nativeCredentials({ psd: { scenario: "OfficeWebPaidConsumerCopilot" } }))).toEqual({ tier: undefined, tierSource: "default" });
    expect(resolveM365Tier(pastedCredentials())).toEqual({ tier: undefined, tierSource: "default" });
    expect(resolveConnectionParams(nativeCredentials({ psd: { tier: "edu" } }))).toMatchObject({ isEdu: "true", scenario: "OfficeWebIncludedCopilot" });
    expect(resolveConnectionParams(nativeCredentials({ psd: { tier: "individual" } })).agent).toBeUndefined();
  });

  it("applies the automatic tier to a native connection served through the gateway", async () => {
    await seedNative();
    script(update({ text: "ok" }));
    expect((await openai([{ role: "user", content: "hi" }], { stream: false })).status).toBe(200);
    expect(sockets[0].query.get("agent")).toBe("work");
  });
});

describe("M365 connect dialog", () => {
  it("starts the PKCE sign-in, shows the Microsoft URL and exchanges the pasted callback", async () => {
    const { Window } = await import("happy-dom");
    const window = new Window({ url: "https://durindoor.local/dashboard/providers/copilot-m365-web" });
    const saved = {};
    for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
      saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    }
    const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    define("window", window);
    define("document", window.document);
    define("navigator", window.navigator);
    define("HTMLElement", window.HTMLElement);
    define("Node", window.Node);
    define("Event", window.Event);
    define("MouseEvent", window.MouseEvent);
    define("IS_REACT_ACT_ENVIRONMENT", true);

    // The dialog's requests go to the real OAuth route handlers.
    const dialogRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      // Server-side token requests stay on the closed identity fake.
      if (!String(url).startsWith("/api/")) return fakeFetch(url, init);
      const [, , , provider, action] = String(url).split("/");
      const body = JSON.parse(init.body);
      dialogRequests.push({ url: String(url), body });
      return api.oauth.POST(json(String(url), "POST", body), { params: Promise.resolve({ provider, action }) });
    };
    tokenHandler = () => jsonResponse({ token_type: "Bearer", expires_in: 4500, access_token: accessJwt(WORK, { tag: "dialog" }), refresh_token: "rt-dialog" });

    vi.doMock("@/shared/ui/v5/production/uiVersion.js", () => ({ useUiV5: () => false }));
    vi.doMock("@/shared/ui/components/Modal", async () => {
      const React = await import("react");
      return { default: ({ open, title, children }) => (open ? React.createElement("div", { role: "dialog", "aria-label": title }, children) : null) };
    });
    vi.doMock("@/shared/ui/components/Button", async () => {
      const React = await import("react");
      return { default: ({ children, onClick, disabled }) => React.createElement("button", { type: "button", onClick, disabled }, children) };
    });
    vi.doMock("@/shared/ui/components/Input", async () => {
      const React = await import("react");
      return {
        default: ({ label, value, onChange, error }) => React.createElement("label", null, label,
          React.createElement("input", { "aria-label": label, value, onChange }),
          error ? React.createElement("p", { role: "alert" }, error) : null),
      };
    });

    try {
      const React = await import("react");
      const { act } = React;
      const { createRoot } = await import("react-dom/client");
      const { default: CopilotM365AuthModal } = await import("../../src/shared/components/CopilotM365AuthModal.js");
      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const onSuccess = vi.fn();
      const root = createRoot(container);
      await act(async () => {
        root.render(React.createElement(CopilotM365AuthModal, { isOpen: true, providerInfo: { name: "Microsoft 365 Copilot Web" }, onSuccess, onClose: () => {} }));
      });
      const button = (name) => [...container.querySelectorAll("button")].find((node) => node.textContent.includes(name));
      expect(container.querySelector('[role="dialog"]').getAttribute("aria-label")).toBe("Sign in to Microsoft 365 Copilot Web");

      await act(async () => { button("Start sign-in").click(); });
      await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull());
      expect(dialogRequests[0]).toEqual({ url: "/api/oauth/copilot-m365-web/authorize", body: {} });
      const authUrl = new URL(container.querySelector("a").getAttribute("href"));
      expect(authUrl.origin + authUrl.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(authUrl.searchParams.get("redirect_uri")).toBe(NATIVE);
      expect(container.innerHTML).not.toMatch(/code_verifier|codeVerifier/);
      const state = authUrl.searchParams.get("state");

      // A wrong address is refused locally, before any exchange.
      const input = container.querySelector('input[aria-label="Callback URL"]');
      const type = async (value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        await act(async () => {
          setter.call(input, value);
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
        });
      };
      await type("https://m365.cloud.microsoft/chat?code=x");
      await act(async () => { button("Connect").click(); });
      expect(container.querySelector('[role="alert"]').textContent).toContain("native-client");
      expect(dialogRequests).toHaveLength(1);

      await type(`${NATIVE}?code=dialog-code&state=${state}&session_state=synthetic`);
      await act(async () => { button("Connect").click(); });
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(dialogRequests[1].url).toBe("/api/oauth/copilot-m365-web/exchange");
      expect(dialogRequests[1].body).toMatchObject({ state, code: expect.stringContaining("code=dialog-code") });
      const token = calls.find((call) => call.url.endsWith("/oauth2/v2.0/token"));
      expect(new URLSearchParams(token.body).get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      const rows = await api.getProviderConnections();
      expect(rows.find((row) => row.provider === "copilot-m365-web" && row.authType === "oauth")).toMatchObject({ email: WORK.email });
      await act(async () => root.unmount());
    } finally {
      globalThis.fetch = originalFetch;
      for (const name of ["@/shared/ui/v5/production/uiVersion.js", "@/shared/ui/components/Modal", "@/shared/ui/components/Button", "@/shared/ui/components/Input"]) vi.doUnmock(name);
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      await window.happyDOM.close();
    }
  });
});
