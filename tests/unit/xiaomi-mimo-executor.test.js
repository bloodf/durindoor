// port(upstream): #4245 - Xiaomi MiMo dual-route executor (73cb891 + 910db74).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMimoAccountCookie = vi.hoisted(() => vi.fn());
const invalidateMimoAccountCookieCache = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/shared/mimoAccount.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getMimoAccountCookie,
  invalidateMimoAccountCookieCache,
}));

import { XiaomiMimoExecutor, __test__ } from "../../open-sse/executors/xiaomi-mimo.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const { bareModel, COOKIE_KEY } = __test__;
const OPENAI_T = { runtimeTransport: { format: "openai", baseUrl: "https://api.xiaomimimo.com/v1/chat/completions" } };
const CLAUDE_T = { runtimeTransport: { format: "claude", baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages" } };
const session = (region, extra = {}) => ({ providerSpecificData: { mimoPassToken: "pt", ...(region ? { region } : null) }, [COOKIE_KEY]: "serviceToken=abc", ...extra });

describe("xiaomi-mimo executor", () => {
  let ex;
  beforeEach(() => {
    ex = new XiaomiMimoExecutor();
    getMimoAccountCookie.mockReset();
    invalidateMimoAccountCookieCache.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("is registered for xiaomi-mimo", () => {
    expect(getExecutor("xiaomi-mimo")).toBeInstanceOf(XiaomiMimoExecutor);
  });

  it("keeps the sourceFormat-matched cloud endpoint for sk- connections", () => {
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, CLAUDE_T)).toBe(CLAUDE_T.runtimeTransport.baseUrl);
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, OPENAI_T)).toBe(OPENAI_T.runtimeTransport.baseUrl);
    // A passToken alone is not enough: the route switches only once a cookie resolved.
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, { ...OPENAI_T, providerSpecificData: { mimoPassToken: "pt" } }))
      .toBe(OPENAI_T.runtimeTransport.baseUrl);
  });

  it("resolves the account-service cluster per connection region, defaulting to sgp", () => {
    const url = (host) => `https://mimo-server-${host}.xiaomimimo.com/api/route/chat/completions`;
    expect(ex.buildUrl("mimo-v2.6-flash", true, 0, session())).toBe(url("sgp"));
    for (const r of ["cn", "sgp", "ams", "ru", "in"]) expect(ex.buildUrl("mimo-v2.6-pro", true, 0, session(r))).toBe(url(r));
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, session("SGP"))).toBe(url("sgp"));
    expect(ex.buildUrl("mimo-v2.6-pro", true, 0, session("eu"))).toBe(url("sgp"));
    // Cloud-only models never take the account route.
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, { ...session(), ...OPENAI_T })).toBe(OPENAI_T.runtimeTransport.baseUrl);
  });

  it("authenticates the account route with the session cookie, cloud calls with the key", () => {
    const acct = ex.buildHeaders({ ...session(), apiKey: "sk-x" }, true, null, "mimo-v2.6-flash");
    expect(acct.Cookie).toBe("serviceToken=abc");
    expect(acct.Authorization).toBeUndefined();
    const cloud = ex.buildHeaders({ apiKey: "sk-x" }, true, null, "mimo-v2.5-pro");
    expect(cloud.Authorization).toBe("Bearer sk-x");
    expect(cloud.Cookie).toBeUndefined();
  });

  it("names the model xiaomi/<id> and bridges reasoning_effort on the account route", () => {
    const out = ex.transformRequest("mimo-v2.6-pro", {
      model: "mimo-v2.6-pro", messages: [{ role: "user", content: "hi" }], reasoning_effort: "xhigh", temperature: 0.2,
    }, true, session());
    expect(out.model).toBe("xiaomi/mimo-v2.6-pro");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.output_config).toEqual({ effort: "high" });
    expect(out.temperature).toBe(0.2);
    expect(out.top_p).toBe(0.95);
  });

  it("keeps content-part arrays for multimodal inputs", () => {
    const parts = [{ type: "image_url", image_url: { url: "data:image/png;base64,xyz" } }, { type: "text", text: "hi" }];
    const out = ex.transformRequest("mimo-v2.6-pro", { messages: [{ role: "user", content: parts }] }, true, session());
    expect(out.messages[0].content).toEqual(parts);
  });

  it("leaves cloud bodies untouched", () => {
    const out = ex.transformRequest("mimo-v2.6-pro", { model: "mimo-v2.6-pro", messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" }, true, OPENAI_T);
    expect(out.model).toBe("mimo-v2.6-pro");
    expect(out.output_config).toBeUndefined();
    expect(out.temperature).toBeUndefined();
  });

  it("strips a provider/model prefix", () => {
    expect(bareModel("xiaomi/mimo-v2.6-pro")).toBe("mimo-v2.6-pro");
    expect(bareModel("mimo-v2.6-flash")).toBe("mimo-v2.6-flash");
  });

  describe("execute", () => {
    const ok = (status = 200) => ({ response: new Response("{}", { status }) });
    const creds = () => ({ apiKey: "sk-x", providerSpecificData: { mimoPassToken: "pt", region: "cn" } });

    it("sends sk- only connections straight to the cloud without a handshake", async () => {
      const parent = vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValue(ok());
      await ex.execute({ model: "mimo-v2.6-pro", credentials: { apiKey: "sk-x" } });
      expect(getMimoAccountCookie).not.toHaveBeenCalled();
      expect(parent.mock.calls[0][0].credentials[COOKIE_KEY]).toBeUndefined();
    });

    it("uses the account route with a per-request cookie and never mutates stored credentials", async () => {
      getMimoAccountCookie.mockResolvedValue("serviceToken=abc");
      const parent = vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValue(ok());
      const c = creds();
      await ex.execute({ model: "mimo-v2.6-pro", credentials: c, proxyOptions: null });
      expect(getMimoAccountCookie).toHaveBeenCalledWith(c.providerSpecificData, null);
      expect(parent.mock.calls[0][0].credentials[COOKIE_KEY]).toBe("serviceToken=abc");
      expect(c[COOKIE_KEY]).toBeUndefined();
    });

    it("falls back to the cloud API when the session handshake fails", async () => {
      getMimoAccountCookie.mockResolvedValue(null);
      const parent = vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValue(ok());
      await ex.execute({ model: "mimo-v2.6-pro", credentials: creds() });
      expect(parent).toHaveBeenCalledTimes(1);
      expect(parent.mock.calls[0][0].credentials[COOKIE_KEY]).toBeUndefined();
    });

    it("refreshes the session once on 401", async () => {
      getMimoAccountCookie.mockResolvedValueOnce("serviceToken=old").mockResolvedValueOnce("serviceToken=new");
      const parent = vi.spyOn(DefaultExecutor.prototype, "execute").mockResolvedValueOnce(ok(401)).mockResolvedValueOnce(ok());
      const result = await ex.execute({ model: "mimo-v2.6-flash", credentials: creds() });
      expect(invalidateMimoAccountCookieCache).toHaveBeenCalledTimes(1);
      expect(parent.mock.calls[1][0].credentials[COOKIE_KEY]).toBe("serviceToken=new");
      expect(result.response.status).toBe(200);
    });
  });
});

describe("xiaomi-mimo registry", () => {
  const entry = REGISTRY.find((e) => e.id === "xiaomi-mimo");

  it("declares dual auth, the five clusters and usage", () => {
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth", "apikey"]);
    expect(entry.regions.map((r) => r.id)).toEqual(["cn", "sgp", "ams", "ru", "in"]);
    expect(entry.defaultRegion).toBe("sgp");
    expect(entry.features).toMatchObject({ usage: true, usageApikey: true });
  });

  it("pins the dual-route v2.6 models to the OpenAI format the account route speaks", () => {
    for (const id of ["mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.6-pro-ultraspeed"]) {
      const model = entry.models.find((m) => m.id === id);
      expect(model.supportedFormats).toEqual(["openai"]);
      // The cloud API takes the bare id; the executor adds xiaomi/ on the account route.
      expect(model.upstreamModelId).toBeUndefined();
    }
  });
});
