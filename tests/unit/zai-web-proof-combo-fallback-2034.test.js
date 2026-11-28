/**
 * #2034: a Z.ai Web proof refusal decided before any POST must not stop a combo.
 *
 * Real: isolated SQLite database, API-key admission (`requireApiKey: true` and a key
 * minted by the real repo), combo resolution, account and proxy-pool selection, the
 * public OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) routes, chatCore,
 * the zai-web executor and the OpenAI executor. Mocked: only the outbound transport
 * (`proxyAwareFetch`) and the global fetch, which refuses every call. Every token, key
 * and proof is synthetic and nothing leaves the process.
 *
 * The no-proof and image refusals are local: no Z.ai work exists, so the ordinary
 * request-scoped 400 lets the combo try its next member. A failure after the billable
 * completion POST stays terminal: no next member, no account fallback, one completion.
 *
 * Image input: `glm-5.3` reports `vision: false`, so the shared chatCore modality strip
 * removes image parts before the executor runs. Through the gateway the executor's image
 * refusal is therefore not reached for this model; the image variants below assert that
 * no image byte reaches Z.ai. The executor's own image branch is covered directly at the
 * end of this file (and in fix-zai-source-token-proof-2034.test.js).
 */
import "../translator/registerAll.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-zai-combo-machine" }));
const wire = vi.hoisted(() => ({ send: null }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (url, init, proxyOptions) => wire.send(url, init, proxyOptions),
}));

const ZAI = "https://chat.z.ai";
const OPENAI = "https://api.openai.com";
const COMBO = "zai-proof-combo";
const OPENAI_KEY = "sk-synthetic-openai-next-member";
const STORED_PROOF = "synthetic-stored-proof-zai";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** Unsigned synthetic JWT shape; the executor reads only the `id` claim. */
const ZAI_TOKEN = `${b64({ alg: "none" })}.${b64({ id: "synthetic-zai-user" })}.synthetic-zai-signature`;

/** True when any message still holds an image part or image bytes (the shared strip leaves only text). */
const hasImagePart = (messages = []) => messages.some((message) => Array.isArray(message.content) &&
  message.content.some((part) => ["image_url", "input_image", "image"].includes(part?.type))) ||
  /iVBORw0KGgo|data:image\//.test(JSON.stringify(messages));
let root, repos, routes, clientKey;
/** What the real zai-web executor returned on each attempt, read through a pass-through spy. */
let zaiAttempts;
let calls;
let zaiCompletion;

const openaiAnswer = () => Response.json({
  id: "chatcmpl-next", object: "chat.completion", created: 1, model: "gpt-4o-mini",
  choices: [{ index: 0, message: { role: "assistant", content: "next member answer" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
});

async function upstream(url, init = {}, proxyOptions) {
  const target = new URL(String(url));
  calls.push({ origin: target.origin, pathname: target.pathname, headers: new Headers(init.headers), body: init.body, proxyOptions });
  if (target.origin === ZAI && target.pathname === "/api/v1/chats/new") return Response.json({ id: "synthetic-chat" });
  if (target.origin === ZAI && target.pathname === "/api/v2/chat/completions") return zaiCompletion();
  if (target.origin === OPENAI && target.pathname === "/v1/chat/completions") return openaiAnswer();
  throw new Error(`closed boundary: unexpected ${target.origin}${target.pathname}`);
}
/** Read the body, then let fire-and-forget usage bookkeeping finish before the database closes. */
async function settled(response) {
  const text = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return text;
}
const zaiCalls = () => calls.filter((call) => call.origin === ZAI);
const openaiCalls = () => calls.filter((call) => call.origin === OPENAI);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "zai-proof-combo-2034-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  calls = [];
  zaiCompletion = () => new Response('data: {"data":{"phase":"answer","delta_content":"zai answer"}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  wire.send = upstream;
  vi.stubGlobal("fetch", vi.fn(async (url) => { throw new Error(`closed boundary: unexpected global fetch ${url}`); }));
  for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation(() => {});
  repos = {
    connections: await import("../../src/lib/db/repos/connectionsRepo.js"),
    combos: await import("../../src/lib/db/repos/combosRepo.js"),
    keys: await import("../../src/lib/db/repos/apiKeysRepo.js"),
    settings: await import("../../src/lib/db/repos/settingsRepo.js"),
    pools: await import("../../src/lib/db/repos/proxyPoolsRepo.js"),
  };
  zaiAttempts = [];
  const { ZaiWebExecutor } = await import("../../open-sse/executors/zai-web.js");
  const execute = ZaiWebExecutor.prototype.execute;
  vi.spyOn(ZaiWebExecutor.prototype, "execute").mockImplementation(async function observed(input) {
    const result = await execute.call(this, input);
    const error = await result.response.clone().json().catch(() => null);
    zaiAttempts.push({ status: result.response.status, code: error?.error?.code ?? null, claudeRequestScoped: result.claudeRequestScoped, images: hasImagePart(input.body?.messages) });
    return result;
  });
  routes = {
    chat: (await import("../../src/app/api/v1/chat/completions/route.js")).POST,
    messages: (await import("../../src/app/api/v1/messages/route.js")).POST,
  };
  await repos.settings.updateSettings({ requireApiKey: true });
  clientKey = (await repos.keys.createApiKey("synthetic admitted client", "synthetic-zai-combo-machine")).key;
}, 60000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** One Z.ai account on its own strict proxy, with or without a stored proof. */
async function zaiAccount({ proof = null } = {}) {
  const pool = await repos.pools.createProxyPool({ name: "synthetic-zai-pool", proxyUrl: "http://proxy-zai.invalid:8080", strictProxy: true });
  return repos.connections.createProviderConnection({
    provider: "zai-web", authType: "cookie", name: "zai", apiKey: `token=${ZAI_TOKEN}`, priority: 1, isActive: true,
    providerSpecificData: { token: ZAI_TOKEN, proxyPoolId: pool.id, ...(proof ? { captchaVerifyParam: proof } : null) },
  });
}
async function openaiAccount() {
  const pool = await repos.pools.createProxyPool({ name: "synthetic-openai-pool", proxyUrl: "http://proxy-openai.invalid:8080", strictProxy: true });
  return repos.connections.createProviderConnection({
    provider: "openai", authType: "apikey", name: "openai", apiKey: OPENAI_KEY, priority: 1, isActive: true,
    providerSpecificData: { proxyPoolId: pool.id },
  });
}
// Both members lack vision, so capability ordering keeps Z.ai first even for an image request.
const comboOf = () => repos.combos.createCombo({ name: COMBO, models: ["zai-web/glm-5.3", "openai/gpt-4"] });

const content = (image) => image
  ? [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }]
  : "hello";
function openaiRequest({ model = COMBO, image = false, key = clientKey } = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: content(image) }] }),
  });
}
function anthropicRequest({ model = COMBO, image = false } = {}) {
  const parts = image
    ? [{ type: "text", text: "describe" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]
    : "hello";
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": clientKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 32, stream: false, messages: [{ role: "user", content: parts }] }),
  });
}

/** The next member really ran, on its own account and proxy, and Z.ai saw no request at all. */
function expectFellBackWithoutZaiWork() {
  // The Z.ai member really ran first and refused locally, without the request-terminal marker.
  expect(zaiAttempts).toEqual([expect.objectContaining({ status: 400, code: "zai_proof_required", claudeRequestScoped: false, images: false })]);
  expect(zaiCalls()).toEqual([]);
  expect(openaiCalls()).toHaveLength(1);
  expect(openaiCalls()[0].headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
  expect(openaiCalls()[0].proxyOptions?.connectionProxyUrl).toBe("http://proxy-openai.invalid:8080");
  expect(JSON.stringify(calls.map((call) => call.body ?? ""))).not.toContain(ZAI_TOKEN);
}

describe("#2034: Z.ai prework proof refusal falls back through a combo", () => {
  it("rejects an unadmitted client key before any provider work", async () => {
    await zaiAccount();
    await openaiAccount();
    await comboOf();
    const response = await routes.chat(openaiRequest({ key: "sk-synthetic-not-admitted" }));
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  }, 60000);

  it.each([false, true])("OpenAI route: a proofless Z.ai account falls to the next combo member (image: %s)", async (image) => {
    const zai = await zaiAccount();
    await openaiAccount();
    await comboOf();
    const response = await routes.chat(openaiRequest({ image }));
    const text = await settled(response);
    expect(response.status).toBe(200);
    expect(JSON.parse(text).choices[0].message.content).toBe("next member answer");
    expectFellBackWithoutZaiWork();
    // A local refusal says nothing about the Z.ai account's health.
    expect((await repos.connections.getProviderConnectionById(zai.id)).testStatus).not.toBe("unavailable");
  }, 60000);

  it.each([false, true])("Anthropic route: a proofless Z.ai account falls to the next combo member (image: %s)", async (image) => {
    await zaiAccount();
    await openaiAccount();
    await comboOf();
    const response = await routes.messages(anthropicRequest({ image }));
    const text = await settled(response);
    expect(response.status).toBe(200);
    // The Messages route may answer as JSON or as an Anthropic event stream; either carries the member's text.
    expect(text).toContain("next member answer");
    expect(text).not.toMatch(/zai_proof_required|"type":"error"/);
    expectFellBackWithoutZaiWork();
  }, 60000);

  it("an image request with a stored proof sends no image byte to Z.ai (shared strip runs first)", async () => {
    await zaiAccount({ proof: STORED_PROOF });
    await openaiAccount();
    await comboOf();
    const response = await routes.chat(openaiRequest({ image: true }));
    const text = await settled(response);
    // Pre-existing shared behavior, unchanged here: the non-vision member gets a text-only turn.
    expect(response.status).toBe(200);
    expect(text).toContain("zai answer");
    expect(zaiAttempts).toEqual([expect.objectContaining({ status: 200, images: false })]);
    const completions = zaiCalls().filter((call) => call.pathname === "/api/v2/chat/completions");
    expect(completions).toHaveLength(1);
    expect(JSON.stringify(zaiCalls().map((call) => call.body))).not.toMatch(/iVBORw0KGgo|image_url|data:image/);
    expect(openaiCalls()).toEqual([]);
  }, 60000);

  it.each([["OpenAI", "chat", openaiRequest], ["Anthropic", "messages", anthropicRequest]])(
    "%s route: a direct Z.ai request without a proof stays a 400 with no POST",
    async (_label, route, request) => {
      await zaiAccount();
      await openaiAccount();
      const response = await routes[route](request({ model: "zai-web/glm-5.3" }));
      const text = await settled(response);
      expect(response.status).toBe(400);
      expect(text).toContain("zai_proof_required");
      expect(text).not.toContain(ZAI_TOKEN);
      expect(calls).toEqual([]);
    },
    60000,
  );

  it("a failure after the billable completion POST stays terminal: no next member, one completion", async () => {
    await zaiAccount({ proof: STORED_PROOF });
    await openaiAccount();
    await comboOf();
    zaiCompletion = () => new Response('data: {"data":{"error":{"message":"synthetic rejected proof"}}}\n\n', { headers: { "content-type": "text/event-stream" } });
    const response = await routes.chat(openaiRequest());
    const text = await settled(response);
    expect(response.ok).toBe(false);
    expect(text).not.toMatch(/next member answer|synthetic rejected proof|synthetic-stored-proof/);
    expect(zaiCalls().map((call) => call.pathname)).toEqual(["/api/v1/chats/new", "/api/v2/chat/completions"]);
    expect(zaiCalls().every((call) => call.proxyOptions?.connectionProxyUrl === "http://proxy-zai.invalid:8080")).toBe(true);
    expect(JSON.parse(zaiCalls()[1].body).captcha_verify_param).toBe(STORED_PROOF);
    expect(openaiCalls()).toEqual([]);
  }, 60000);

  it("a throw from the billable completion send stays terminal with an unknown-outcome message", async () => {
    await zaiAccount({ proof: STORED_PROOF });
    await openaiAccount();
    await comboOf();
    zaiCompletion = () => { throw new Error(`synthetic completion socket failure ${ZAI_TOKEN}`); };
    const response = await routes.chat(openaiRequest());
    const text = await settled(response);
    expect(response.ok).toBe(false);
    expect(text).toContain("completion was not replayed");
    expect(text).not.toMatch(/synthetic completion socket|next member answer/);
    expect(text).not.toContain(ZAI_TOKEN);
    expect(zaiCalls().filter((call) => call.pathname === "/api/v2/chat/completions")).toHaveLength(1);
    expect(openaiCalls()).toEqual([]);
  }, 60000);
});

describe("#2034: Z.ai executor prework refusals carry no request-terminal marker", () => {
  it.each([
    ["no proof", { messages: [{ role: "user", content: "hello" }] }, {}],
    ["a stored proof with image input", { messages: [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] }] }, { captchaVerifyParam: STORED_PROOF }],
    ["a request proof with image input", { messages: [{ role: "user", content: [{ type: "input_image", image_url: "https://invalid/image" }] }], captcha_verify_param: "synthetic-request-proof" }, {}],
  ])("%s: 400 zai_proof_required, marker false, no POST, proof redacted", async (_label, body, stored) => {
    const { ZaiWebExecutor } = await import("../../open-sse/executors/zai-web.js");
    const result = await new ZaiWebExecutor().execute({
      model: "glm-5.3", stream: false, body,
      credentials: { connectionId: "a", providerSpecificData: { token: ZAI_TOKEN, ...stored } },
      proxyOptions: { connectionProxyEnabled: true, proxyPoolId: "route-a" },
    });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("zai_proof_required");
    expect(result.claudeRequestScoped).toBe(false);
    expect(JSON.stringify(result.transformedBody)).not.toMatch(/synthetic-request-proof|synthetic-stored-proof/);
    expect(calls).toEqual([]);
  });
});

describe("#2034: Z.ai setup-failure diagnostic", () => {
  const input = () => ({
    model: "glm-5.3", stream: false,
    credentials: { connectionId: "a", providerSpecificData: { token: ZAI_TOKEN, captchaVerifyParam: STORED_PROOF } },
    body: { messages: [{ role: "user", content: "hello" }] },
    proxyOptions: { connectionProxyEnabled: true, proxyPoolId: "route-a" },
  });

  it.each([
    ["a thrown setup send", () => { throw new Error(`synthetic setup socket failure ${ZAI_TOKEN}`); }],
    ["a setup reply without a chat id", () => Response.json({})],
  ])("%s says setup failed and the completion was not sent, and stays open to fallback", async (_label, setup) => {
    const { ZaiWebExecutor } = await import("../../open-sse/executors/zai-web.js");
    wire.send = async (url, init, proxyOptions) => {
      calls.push({ pathname: new URL(String(url)).pathname, proxyOptions });
      if (String(url).endsWith("/new")) return setup();
      throw new Error("closed boundary: completion must not be sent");
    };
    const result = await new ZaiWebExecutor().execute(input());
    const text = await result.response.text();
    expect(result.response.status).toBe(502);
    expect(result.claudeRequestScoped).toBe(false);
    expect(text).toContain("Z.ai chat setup failed; completion was not sent");
    expect(text).not.toMatch(/not replayed|synthetic setup socket|synthetic-stored-proof/);
    expect(text).not.toContain(ZAI_TOKEN);
    expect(calls.map((call) => call.pathname)).toEqual(["/api/v1/chats/new"]);
  });
});
