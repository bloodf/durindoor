/** #2034: every request-proof envelope the Z.ai extractor accepts stays with zai-web only.
 * The real extractor is the oracle. Route cases use the shared real-SQLite public fixture;
 * only management authority and outbound network are replaced, so no vendor behavior is claimed.
 */
import "../translator/registerAll.js";
import { afterEach, describe, expect, it } from "vitest";
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";
import { isolateZaiRequestProof } from "../../open-sse/services/zaiRequestProof.js";
import { extractZaiCaptchaVerifyParam as extract, redactZaiProof } from "../../open-sse/executors/zai-web/session.js";

const P = "synthetic-envelope-proof";
const aliases = ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"];
const json = (value) => JSON.stringify(value);
const deepFreeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

// [name, body, expected outbound body for other providers]
const accepted = [
  ...aliases.map((a) => [`top ${a}`, { [a]: P, keep: 1 }, { keep: 1 }]),
  ...aliases.map((a) => [`record PSD ${a}`, { providerSpecificData: { [a]: P, keep: "yes" } }, { providerSpecificData: { keep: "yes" } }]),
  ...aliases.map((a) => [`JSON PSD ${a}`, { providerSpecificData: json({ [a]: P, keep: "yes" }) }, { providerSpecificData: json({ keep: "yes" }) }]),
  ["cookie PSD", { providerSpecificData: `captcha_verify_param=${P}; keep=yes` }, { providerSpecificData: "keep=yes" }],
  ["cookie PSD middle", { providerSpecificData: `a=1; captcha_verify_param=${P}; keep=yes` }, { providerSpecificData: "a=1; keep=yes" }],
  ["cookie PSD last", { providerSpecificData: `a=1;captcha_verify_param=${P}` }, { providerSpecificData: "a=1" }],
  ["malformed-JSON cookie fallback", { providerSpecificData: `{bad; captcha_verify_param=${P}` }, { providerSpecificData: "{bad" }],
  ["JSON PSD -> JSON PSD", { providerSpecificData: json({ keep: 1, providerSpecificData: json({ captchaVerifyParam: P, deep: 2 }) }) }, { providerSpecificData: json({ keep: 1, providerSpecificData: json({ deep: 2 }) }) }],
  ["JSON PSD -> cookie PSD", { providerSpecificData: json({ keep: 1, providerSpecificData: `captcha_verify_param=${P}; deep=2` }) }, { providerSpecificData: json({ keep: 1, providerSpecificData: "deep=2" }) }],
  ["record PSD -> cookie PSD", { providerSpecificData: { keep: 1, providerSpecificData: `captcha_verify_param=${P}` } }, { providerSpecificData: { keep: 1 } }],
  ["record PSD -> JSON PSD", { providerSpecificData: { keep: 1, providerSpecificData: json({ zaiCaptchaVerifyParam: P }) } }, { providerSpecificData: { keep: 1 } }],
  ["blank direct falls through to PSD string", { captcha_verify_param: " ", providerSpecificData: json({ captcha_verify_param: P, keep: 1 }) }, { providerSpecificData: json({ keep: 1 }) }],
  ["mixed record and string", { captchaVerifyParam: P, providerSpecificData: { zaiCaptchaVerifyParam: P, keep: 1, providerSpecificData: `captcha_verify_param=${P}` } }, { providerSpecificData: { keep: 1 } }],
  // Proof-only wrappers: removal empties them, so the wrapper is omitted too.
  ["proof-only record PSD", { providerSpecificData: { captcha_verify_param: P } }, {}],
  ["proof-only JSON PSD", { providerSpecificData: json({ captchaVerifyParam: P }) }, {}],
  ["proof-only cookie PSD", { providerSpecificData: `captcha_verify_param=${P}` }, {}],
  ["proof-only cookie PSD with separators", { providerSpecificData: `captcha_verify_param=${P}; ` }, {}],
  ["proof-only nested JSON -> cookie", { providerSpecificData: json({ providerSpecificData: `captcha_verify_param=${P}` }) }, {}],
  ["proof-only nested record -> JSON", { providerSpecificData: { providerSpecificData: json({ captcha_verify_param: P }) }, temperature: 0.2 }, { temperature: 0.2 }],
];

// Not accepted by the extractor (or carrying no proof): kept exactly as sent.
const controls = [
  ["originally empty record PSD", { providerSpecificData: {} }],
  ["originally empty string PSD", { providerSpecificData: "" }],
  ["originally empty JSON PSD", { providerSpecificData: "{}" }],
  ["unrelated cookie PSD", { providerSpecificData: "a=1; keep=yes" }],
  ["no cookie boundary", { providerSpecificData: `foo captcha_verify_param=${P}` }],
  ["leading space before first cookie", { providerSpecificData: ` captcha_verify_param=${P}` }],
  ["case-mismatched cookie name", { providerSpecificData: `Captcha_Verify_Param=${P}` }],
  ["empty cookie value", { providerSpecificData: "captcha_verify_param=; keep=yes" }],
  ["malformed JSON without cookie", { providerSpecificData: `{"captcha_verify_param":"${P}"` }],
  ["JSON array", { providerSpecificData: json([{ captcha_verify_param: P }]) }],
  ["non-string PSD", { providerSpecificData: 42 }],
  ["proof-like message text", { messages: [{ role: "user", content: `captcha_verify_param=${P}; ${json({ captcha_verify_param: P })}` }], metadata: { note: `captcha_verify_param=${P}` } }],
];

describe("accepted envelopes: oracle-recognized, zai-web unchanged, omitted elsewhere", () => {
  it.each(accepted)("%s", (_name, body, expected) => {
    const original = structuredClone(body);
    deepFreeze(body);
    expect(extract(body)).toBe(P);
    expect(isolateZaiRequestProof(body, "zai-web")).toBe(body);
    for (const provider of ["openai", "anthropic", "zai"]) {
      const out = isolateZaiRequestProof(body, provider);
      expect(out).toEqual(expected);
      expect(extract(out)).toBe("");
      for (const value of strings(out)) expect(extract(value)).toBe("");
      expect(json(out)).not.toMatch(new RegExp(`${P}|REDACTED`));
    }
    expect(body).toEqual(original);
    expect(extract(body)).toBe(P);
  });
});

describe("unrecognized and proof-free controls keep existing behavior", () => {
  it.each(controls)("%s", (_name, body) => {
    const original = structuredClone(body);
    expect(extract(body)).toBe("");
    const out = isolateZaiRequestProof(deepFreeze(body), "openai");
    expect(out).toEqual(original);
    expect(redactZaiProof(body)).toEqual(original);
  });
});

describe("audit copies", () => {
  it("keeps existing top-level and record [REDACTED] semantics", () => {
    const body = deepFreeze({ captcha_verify_param: P, captchaVerifyParam: 7, keep: 1, providerSpecificData: { zaiCaptchaVerifyParam: P, other: 2 } });
    expect(redactZaiProof(body)).toEqual({ captcha_verify_param: "[REDACTED]", captchaVerifyParam: "[REDACTED]", keep: 1, providerSpecificData: { zaiCaptchaVerifyParam: "[REDACTED]", other: 2 } });
    expect(redactZaiProof({ providerSpecificData: { captcha_verify_param: P } })).toEqual({ providerSpecificData: { captcha_verify_param: "[REDACTED]" } });
    expect(redactZaiProof("not-a-record")).toBe("not-a-record");
  });
  it.each([
    ["JSON PSD", json({ captcha_verify_param: P, keep: "yes" }), json({ captcha_verify_param: "[REDACTED]", keep: "yes" })],
    ["cookie PSD", `captcha_verify_param=${P}; keep=yes`, "captcha_verify_param=[REDACTED]; keep=yes"],
    ["cookie PSD middle", `a=1; captcha_verify_param=${P}`, "a=1; captcha_verify_param=[REDACTED]"],
    ["nested JSON -> cookie", json({ providerSpecificData: `captcha_verify_param=${P}` }), json({ providerSpecificData: "captcha_verify_param=[REDACTED]" })],
    ["proof-only JSON keeps wrapper", json({ captchaVerifyParam: P }), json({ captchaVerifyParam: "[REDACTED]" })],
  ])("redacts accepted string form %s", (_name, psd, expected) => {
    const body = deepFreeze({ providerSpecificData: psd, keep: 1 });
    expect(redactZaiProof(body)).toEqual({ providerSpecificData: expected, keep: 1 });
    expect(json(redactZaiProof(body))).not.toContain(P);
    expect(body.providerSpecificData).toBe(psd);
  });
  it.each(accepted)("never retains the proof: %s", (_name, body) => {
    expect(json(redactZaiProof(body))).not.toContain(P);
  });
});

it("concurrent isolation shares no proof and leaves each caller intact", async () => {
  const bodies = ["a", "b", "c"].map((id) => deepFreeze({ providerSpecificData: id === "a" ? json({ captcha_verify_param: `${P}-${id}`, keep: id }) : `captcha_verify_param=${P}-${id}; keep=${id}` }));
  const results = await Promise.all(bodies.flatMap((body) => ["openai", "zai-web"].map((provider) => Promise.resolve().then(() => isolateZaiRequestProof(body, provider)))));
  ["a", "b", "c"].forEach((id, index) => {
    const [other, zai] = results.slice(index * 2, index * 2 + 2);
    expect(json(other)).not.toContain(P);
    expect(zai).toBe(bodies[index]);
    expect(extract(zai)).toBe(`${P}-${id}`);
  });
});

describe("public route: direct, Z.ai-setup fallback and later Z.ai member", () => {
  const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"id":"synthetic-user"}').toString("base64url")}.synthetic`;
  const forms = [
    ["JSON PSD", json({ captcha_verify_param: P, keep: "yes" }), json({ keep: "yes" })],
    ["cookie PSD", `captcha_verify_param=${P}; keep=yes`, "keep=yes"],
    ["nested JSON -> cookie PSD", json({ keep: "yes", providerSpecificData: `captcha_verify_param=${P}` }), json({ keep: "yes" })],
    ["proof-only cookie PSD", `captcha_verify_param=${P}`, undefined],
  ];
  let flow, headers, dispatchers;
  afterEach(async () => { await flow?.close(); flow = undefined; });
  async function setup(order) {
    flow = await cookiePublicFlow2034("zai-web");
    dispatchers = {};
    for (const provider of ["zai-web", "openai"]) {
      const row = await flow.db.createProviderConnection({ provider, authType: provider === "openai" ? "apikey" : "cookie", name: provider, apiKey: provider === "openai" ? "sk-synthetic-other" : `token=${token}`, isActive: true, providerSpecificData: provider === "openai" ? {} : { token } });
      dispatchers[provider] = await flow.bind(row.id, provider);
    }
    await flow.db.createCombo({ name: "envelope-isolation", models: order });
    await flow.db.updateSettings({ requireApiKey: true });
    headers = { authorization: `Bearer ${(await flow.db.createApiKey("synthetic-client", "synthetic-machine")).key}` };
  }
  const answer = () => Response.json({ id: "synthetic", object: "chat.completion", model: "gpt-4", choices: [{ index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  function network({ failOther = false, failSetup = true } = {}) {
    flow.network.mockImplementation(async (url, init) => {
      const u = new URL(String(url));
      if (u.hostname === "api.openai.com") {
        expect(init.dispatcher).toBe(dispatchers.openai);
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-synthetic-other");
        return failOther ? Response.json({ error: { message: "synthetic unavailable" } }, { status: 503 }) : answer();
      }
      expect(u.origin).toBe("https://chat.z.ai");
      expect(init.dispatcher).toBe(dispatchers["zai-web"]);
      if (u.pathname === "/api/v1/chats/new") return failSetup ? Response.json({}, { status: 503 }) : Response.json({ id: "synthetic-chat" });
      expect(u.pathname).toBe("/api/v2/chat/completions");
      return new Response('data: {"data":{"phase":"answer","delta_content":"answer"}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    });
  }
  const calls = (match) => flow.network.mock.calls.filter(([url]) => String(url).includes(match));
  function assertOther(expected) {
    const other = calls("api.openai.com");
    expect(other.length).toBeGreaterThan(0);
    for (const [, init] of other) {
      expect(init.body).not.toMatch(new RegExp(`${P}|REDACTED`));
      const body = JSON.parse(init.body);
      expect(extract(body)).toBe("");
      expect(body.temperature).toBe(0.4);
      expect(body.providerSpecificData).toBe(expected);
    }
  }
  it.each(forms.flatMap((form) => [false, true].map((stream) => [...form, stream])))("%s (psd %j -> %j) stream=%s: direct and setup-503 fallback omit it", async (_name, psd, expected, stream) => {
    await setup(["zai-web/glm-5.3", "openai/gpt-4"]); network();
    const body = { providerSpecificData: psd, temperature: 0.4 };
    for (const model of ["openai/gpt-4", "envelope-isolation"]) {
      const response = await flow.dispatch({ model, headers, stream, body });
      expect(response.status, await response.text()).toBe(200);
    }
    assertOther(expected);
    expect(calls("/api/v1/chats/new")).toHaveLength(1);
    expect(calls("/api/v2/chat/completions")).toHaveLength(0);
    expect(body.providerSpecificData).toBe(psd);
  }, 60000);
  it.each(forms)("%s (psd %j -> %j): a later Z.ai member still receives the original proof", async (_name, psd, expected) => {
    await setup(["openai/gpt-4", "zai-web/glm-5.3"]); network({ failOther: true, failSetup: false });
    const response = await flow.dispatch({ model: "envelope-isolation", headers, body: { providerSpecificData: psd, temperature: 0.4 } });
    expect(response.status, await response.text()).toBe(200);
    assertOther(expected);
    const completion = calls("/api/v2/chat/completions");
    expect(completion).toHaveLength(1);
    expect(JSON.parse(completion[0][1].body).captcha_verify_param).toBe(P);
    expect(JSON.stringify(await flow.db.getProviderConnections({ provider: "zai-web" }))).not.toContain(P);
  }, 60000);
});
