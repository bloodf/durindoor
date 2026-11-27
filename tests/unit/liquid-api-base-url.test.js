import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({ proxyUrl: "http://proxy.test" })) }));

import liquid from "../../open-sse/providers/registry/liquid.js";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { POST as validate } from "../../src/app/api/providers/validate/route.js";

const base = "https://api.liquid.ai/openai/v1";
const connection = { id: "fixture", provider: "liquid", apiKey: "synthetic-key" };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Liquid API offline contract", () => {
  it("uses the upstream chat models and removes the obsolete free offer", () => {
    expect(liquid.transport).toMatchObject({ baseUrl: `${base}/chat/completions`, validateUrl: `${base}/models`, authHeader: "bearer" });
    expect(liquid.models.filter((m) => m.kind !== "systemone").map((m) => m.id)).toEqual(["lfm3-1.7b", "lfm3-vl-2b", "lfm2.5-24b-a2b"]);
    expect(FREE_MODEL_BUDGETS.filter((m) => m.provider === "liquid")).toEqual([]);
  });
  it("validates credentials against the models endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: [] })));
    const request = new Request("http://localhost/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "liquid", apiKey: connection.apiKey }) });
    expect((await (await validate(request)).json()).valid).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${base}/models`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-key" }) }));
  });
  it("discovers models with the connection credentials and proxy", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ data: [{ id: "lfm3-1.7b" }] }));
    expect(await fetchConnectionModels(connection)).toMatchObject({ models: [{ id: "lfm3-1.7b" }] });
    expect(proxyAwareFetch).toHaveBeenCalledWith(`${base}/models`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-key" }) }), expect.objectContaining({ proxyUrl: "http://proxy.test" }));
  });
});
