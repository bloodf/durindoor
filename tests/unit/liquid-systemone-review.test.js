/** Offline evidence through the real System One core and proxy transport. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

const upstream = { answers: { urgent: true }, usage: { input_tokens: 12, output_tokens: 1 } };
let fetchTransport;
beforeEach(() => {
  fetchTransport = vi.fn(async () => Response.json(upstream));
  vi.stubGlobal("fetch", fetchTransport);
});
afterEach(() => vi.unstubAllGlobals());

async function dispatch(reference, credentials = { apiKey: "synthetic-liquid-key" }) {
  return handleSystemoneCore({
    modelInfo: await getModelInfoCore(reference, {}),
    body: {
      model: reference,
      state: "Payment has failed for three days.",
      questions: { urgent: { type: "noul", instructions: "Is this urgent?" } },
      baseUrl: "https://attacker.invalid",
    },
    credentials,
    proxyOptions: { disableEnvProxy: true },
  });
}

describe("Liquid System One review evidence", () => {
  it.each(["d1", "d1.2", "d1.2-ultra"])("dispatches liquid/%s through the real transport to the fixed origin", async (model) => {
    const result = await dispatch(`liquid/${model}`, {
      apiKey: "synthetic-liquid-key",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest/meta-data" },
    });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(upstream);
    expect(fetchTransport).toHaveBeenCalledOnce();
    const [url, init] = fetchTransport.mock.calls[0];
    expect(url).toBe("https://api.liquid.ai/decisions/v1/systemone");
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer synthetic-liquid-key");
    expect(JSON.parse(init.body)).toMatchObject({ model, questions: { urgent: { type: "noul" } } });
  });

  it.each(["", "../d1", "d1/extra", "d1..2", "d1 2", "d1?url=evil", "d1%2fextra", "a".repeat(101)])("rejects malformed Liquid model %j before transport receives credentials", async (model) => {
    const result = await dispatch(`liquid/${model}`);
    expect(result.status).toBe(400);
    expect(fetchTransport).not.toHaveBeenCalled();
  });

  it("keeps an OpenRouter Liquid model on OpenRouter with its own key", async () => {
    expect((await dispatch("openrouter/liquid/d1.2", { apiKey: "synthetic-openrouter-key" })).success).toBe(true);
    const [url, init] = fetchTransport.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer synthetic-openrouter-key");
    expect(JSON.parse(init.body).model).toBe("liquid/d1.2");
  });

  it("carries redirect refusal through the proxy transport and fails closed", async () => {
    fetchTransport.mockImplementationOnce(async (_url, init) => {
      expect(init.redirect).toBe("error");
      throw new TypeError("unexpected redirect");
    });
    expect((await dispatch("liquid/d1")).status).toBe(502);
    expect(fetchTransport).toHaveBeenCalledOnce();
  });
});
