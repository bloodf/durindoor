/**
 * Issue #1175: offline identity/transport acceptance only; no account-backed proof.
 * Installed `devin` is a Cognition cloud agent, not `devin-desktop`.
 * Read-only upstream desktop metadata declares server.codeium.com, OAuth Bearer,
 * and DEVIN_MODEL_CATALOG; static exports do not prove native runtime support.
 * No g4f, web, or app-server substitute qualifies as a native vendor transport.
 * Desktop request/tool/stream fixtures below require rejection without dispatch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [
    { id: "native", provider: "devin", isActive: true, apiKey: "offline-cloud-token" },
    { id: "candidate", provider: "devin-desktop", isActive: true, accessToken: "offline-desktop-token" },
  ]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", async () => {
  const { FREE_NO_AUTH_PROVIDER_IDS } = await import("../../src/shared/constants/freeNoAuthProviders.js");
  return { getSettings: vi.fn(async () => ({ disabledFreeProviders: FREE_NO_AUTH_PROVIDER_IDS })) };
});

afterEach(() => vi.unstubAllGlobals());

describe("#1175 devin-desktop is not installed devin", () => {
  it("accepts the installed native sessions probe but does not validate desktop using that identity", async () => {
    const fetcher = vi.fn(async () => new Response('{"sessions":[]}', {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    await expect(probeRegistryProvider("devin", "offline-cloud-token", fetcher))
      .resolves.toMatchObject({ valid: true, status: 200 });
    await expect(probeRegistryProvider("devin-desktop", "offline-desktop-token", fetcher))
      .resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.devin.ai/v1/sessions?limit=1");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "GET", headers: { Authorization: "Bearer offline-cloud-token" },
    });
    expect(PROVIDER_ID_TO_ALIAS["devin-desktop"]).toBeUndefined();
    expect(hasSpecializedExecutor("devin-desktop")).toBe(false);
  });

  it("does not discover desktop models or promote either active connection into the LLM catalog", async () => {
    const fetcher = vi.fn(async () => { throw new Error("Unexpected offline discovery fetch"); });
    vi.stubGlobal("fetch", fetcher);
    expect(getModelsByProviderId("devin")).toEqual([
      expect.objectContaining({ id: "devin", kind: "agent" }),
    ]);
    expect(getModelsByProviderId("devin-desktop")).toEqual([]);
    const { buildModelsList, LLM_KIND } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const models = await buildModelsList([LLM_KIND]);
    expect(models.filter(({ id }) => /^(devin|devin-desktop)\//.test(id))).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses desktop URL/header construction when callers bypass execute", () => {
    const fetcher = vi.fn(() => { throw new Error("Unexpected offline fetch"); });
    vi.stubGlobal("fetch", fetcher);
    const executor = getExecutor("devin-desktop");
    const credentials = { accessToken: "offline-desktop-token" };
    // Translator routes can return these values without calling execute().
    expect.soft(() => executor.buildUrl("devin", true, 0, credentials)).toThrow();
    expect.soft(() => executor.buildHeaders(credentials, true)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects unsupported desktop tool requests before any upstream dispatch (stream=%s)", async (stream) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Offline unauthorized fixture", type: "authentication_error" },
    }), { status: 401, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await getExecutor("devin-desktop").execute({
      model: "devin",
      stream,
      credentials: { accessToken: "offline-desktop-token" },
      body: {
        model: "devin", stream,
        messages: [
          { role: "user", content: "Read the offline fixture." },
          { role: "assistant", content: null, tool_calls: [
            { id: "call_fixture", type: "function", function: { name: "read_fixture", arguments: "{}" } },
          ] },
          { role: "tool", tool_call_id: "call_fixture", content: "offline fixture" },
        ],
        tools: [{ type: "function", function: { name: "read_fixture", parameters: { type: "object", properties: {} } } }],
      },
    });
    expect(fetcher, "Unregistered desktop credentials must never reach OpenAI or another substitute").not.toHaveBeenCalled();
    expect(result.response.status).toBe(501);
    expect(await result.response.json()).toMatchObject({
      error: { type: "provider_port_pending", provider: "devin-desktop" },
    });
    expect(result.headers).toEqual({});
  });
});
