/** Real public admission, SQLite, combo/account/strict-proxy selection and executors.
 * Shared fixture replaces management authority; only synthetic outbound network is faked.
 * No live exposure claim: setup 503 is nonbillable and sends no Z.ai completion.
 */
import "../translator/registerAll.js";
import { afterEach, expect, it } from "vitest";
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";
import { isolateZaiRequestProof } from "../../open-sse/services/zaiRequestProof.js";

const aliases = ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"];
const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"id":"synthetic-user"}').toString("base64url")}.synthetic`;
let flow, headers, dispatchers;
afterEach(async () => { await flow?.close(); flow = undefined; });
async function setup(order = ["zai-web/glm-5.3", "openai/gpt-4"]) {
  flow = await cookiePublicFlow2034("zai-web");
  dispatchers = {};
  for (const provider of ["zai-web", "openai"]) {
    const row = await flow.db.createProviderConnection({ provider, authType: provider === "openai" ? "apikey" : "cookie", name: provider, apiKey: provider === "openai" ? "sk-synthetic-other" : `token=${token}`, isActive: true, providerSpecificData: provider === "openai" ? {} : { token } });
    dispatchers[provider] = await flow.bind(row.id, provider);
  }
  await flow.db.createCombo({ name: "proof-isolation", models: order });
  await flow.db.updateSettings({ requireApiKey: true });
  const key = await flow.db.createApiKey("synthetic-client", "synthetic-machine");
  headers = { authorization: `Bearer ${key.key}` };
}
const answer = () => Response.json({ id: "synthetic", object: "chat.completion", model: "gpt-4", choices: [{ index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
function network({ failOther = false, failSetup = true, failCompletion = false } = {}) {
  flow.network.mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === "api.openai.com") {
      expect(init.dispatcher).toBe(dispatchers.openai);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-synthetic-other");
      expect(init.body).not.toContain(token);
      return failOther ? Response.json({ error: { message: "synthetic unavailable" } }, { status: 503 }) : answer();
    }
    expect(u.origin).toBe("https://chat.z.ai");
    expect(init.dispatcher).toBe(dispatchers["zai-web"]);
    if (u.pathname === "/api/v1/chats/new") return failSetup ? Response.json({}, { status: 503 }) : Response.json({ id: "synthetic-chat" });
    expect(u.pathname).toBe("/api/v2/chat/completions");
    if (failCompletion) throw Error("synthetic uncertain completion");
    return new Response('data: {"data":{"phase":"answer","delta_content":"answer"}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  });
}
const proofBody = (alias, nested, proof = "synthetic-client-proof") => nested ? { providerSpecificData: { [alias]: proof, retain: "other-PSD" }, temperature: 0.4 } : { [alias]: proof, temperature: 0.4 };
function assertOtherBodies() {
  const calls = flow.network.mock.calls.filter(([url]) => new URL(String(url)).hostname === "api.openai.com");
  expect(calls.length).toBeGreaterThan(0);
  for (const [, init] of calls) {
    const body = JSON.parse(init.body);
    for (const alias of aliases) { expect(body).not.toHaveProperty(alias); expect(body.providerSpecificData ?? {}).not.toHaveProperty(alias); }
    expect(init.body).not.toMatch(/synthetic-client-proof|REDACTED/);
    expect(body.temperature).toBe(0.4);
    if (body.providerSpecificData) expect(body.providerSpecificData.retain).toBe("other-PSD");
  }
}
it.each(aliases.flatMap(alias => [false, true].flatMap(nested => [false, true].map(stream => [alias, nested, stream]))))(
  "omits %s nested=%s stream=%s on direct and prework fallback", async (alias, nested, stream) => {
    await setup(); network();
    const body = proofBody(alias, nested);
    const original = structuredClone(body);
    for (const model of ["openai/gpt-4", "proof-isolation"]) {
      const response = await flow.dispatch({ model, headers, stream, body });
      expect(response.status, await response.text()).toBe(200);
    }
    assertOtherBodies();
    if (nested) for (const [url, init] of flow.network.mock.calls) if (String(url).includes("api.openai.com")) expect(JSON.parse(init.body).providerSpecificData.retain).toBe("other-PSD");
    expect(flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v1/chats/new"))).toHaveLength(1);
    expect(flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v2/chat/completions"))).toHaveLength(0);
    expect(body).toEqual(original);
  }, 60000);
it.each(aliases.flatMap(alias => [false, true].map(nested => [alias, nested])))("preserves %s nested=%s for a later Z.ai member", async (alias, nested) => {
  await setup(["openai/gpt-4", "zai-web/glm-5.3"]); network({ failOther: true, failSetup: false });
  const response = await flow.dispatch({ model: "proof-isolation", headers, body: proofBody(alias, nested) });
  expect(response.status, await response.text()).toBe(200);
  assertOtherBodies();
  const completion = flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v2/chat/completions"));
  expect(completion).toHaveLength(1);
  expect(JSON.parse(completion[0][1].body).captcha_verify_param).toBe("synthetic-client-proof");
}, 60000);
it("preserves the caller and concurrent members through request-local clones", async () => {
  const body = Object.freeze({ captcha_verify_param: "proof", providerSpecificData: Object.freeze({ captchaVerifyParam: "nested", keep: 42 }) });
  const [other, zai] = await Promise.all([Promise.resolve().then(() => isolateZaiRequestProof(body, "openai")), Promise.resolve().then(() => isolateZaiRequestProof(body, "zai-web"))]);
  expect(other).toEqual({ providerSpecificData: { keep: 42 } });
  expect(zai).toBe(body);
  expect(body.providerSpecificData.captchaVerifyParam).toBe("nested");
});
it("keeps post-completion uncertainty terminal with no successful usage", async () => {
  await setup(); network({ failSetup: false, failCompletion: true });
  const response = await flow.dispatch({ model: "proof-isolation", headers, body: proofBody(aliases[0], false) });
  expect(response.ok).toBe(false); expect(await response.text()).toContain("completion was not replayed");
  expect(flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v2/chat/completions"))).toHaveLength(1);
  expect(flow.network.mock.calls.some(([url]) => String(url).includes("api.openai.com"))).toBe(false);
  expect(flow.usage.mock.calls.some(([entry]) => entry.status === "success")).toBe(false);
}, 60000);
it.each([false, true])("isolates simultaneous admitted requests stream=%s", async (stream) => {
  await setup(); network({ failSetup: false });
  const bodies = [proofBody(aliases[0], false, "synthetic-client-proof-a"), proofBody(aliases[1], true, "synthetic-client-proof-b")];
  const original = structuredClone(bodies);
  const responses = await Promise.all(bodies.map(body => flow.dispatch({ model: "zai-web/glm-5.3", headers, stream, body })));
  for (const response of responses) expect(response.status, await response.text()).toBe(200);
  const proofs = flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v2/chat/completions")).map(([, init]) => JSON.parse(init.body).captcha_verify_param);
  expect(proofs.sort()).toEqual(["synthetic-client-proof-a", "synthetic-client-proof-b"]);
  expect(bodies).toEqual(original);
  const rows = await flow.db.getProviderConnections({ provider: "zai-web" });
  expect(JSON.stringify(rows)).not.toContain("synthetic-client-proof");
}, 60000);
it("retains Messages request-proof behavior without a completion or successful usage", async () => {
  await setup(); network();
  const response = await flow.dispatch({ model: "zai-web/glm-5.3", anthropic: true, headers, body: proofBody(aliases[0], false) });
  const text = await response.text();
  expect(response.ok).toBe(false);
  expect(text).not.toContain("synthetic-client-proof");
  expect(flow.network.mock.calls.some(([url]) => String(url).includes("/api/v2/chat/completions"))).toBe(false);
  expect(flow.usage.mock.calls.some(([entry]) => entry.status === "success")).toBe(false);
}, 60000);
it("parent reproduction: setup 503 falls back without leaking the client proof", async () => {
  await setup(); network();
  const response = await flow.dispatch({ model: "proof-isolation", headers, body: proofBody(aliases[0], false) });
  expect(response.status, await response.text()).toBe(200);
  expect(flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v1/chats/new"))).toHaveLength(1);
  expect(flow.network.mock.calls.filter(([url]) => String(url).includes("/api/v2/chat/completions"))).toHaveLength(0);
  assertOtherBodies();
}, 60000);
