import { afterAll, describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { refreshCodexToken } from "../../open-sse/services/tokenRefresh/providers.js";

const { fetchMock, dataDir, removeDataDir } = await vi.hoisted(async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codex-parity-"));
  vi.stubEnv("DATA_DIR", dir);
  return { fetchMock: vi.fn(), dataDir: dir, removeDataDir: rm };
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await removeDataDir(dataDir, { recursive: true, force: true });
});
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("open-sse/index.js", () => ({ getExecutor: () => new CodexExecutor() }));
vi.mock("@/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: async () => ({ disableEnvProxy: true }),
}));

describe("Codex upstream usage reset envelopes", () => {
  it.each([
    { type: "usage_limit_reached", resets_in_seconds: 60 },
    { body: { error: { type: " USAGE_LIMIT_REACHED ", resets_in_seconds: 60 } } },
    { error: { type: "usage_limit_reached", resets_in_seconds: 60 } },
  ])("uses reset timing from the upstream error envelope", (body) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      expect(new CodexExecutor().parseError({ status: 429, headers: new Headers() }, JSON.stringify(body)).resetsAtMs)
        .toBe(1_700_000_060_000);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("Codex refresh errors", () => {
  it.each(["token_revoked", "invalid_client", "invalid_token"])("does not retry %s", async (code) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ error: code }) });
    expect(await refreshCodexToken(`refresh-${code}`, null)).toMatchObject({ error: "unrecoverable_refresh_error", code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
  });
});

describe("Codex Responses Lite", () => {
  it("serializes ordinary tool calls while retaining delegation model settings", () => {
    const executor = new CodexExecutor();
    const context = { clientHeaders: { "x-openai-internal-codex-responses-lite": "true" } };
    const make = (model) => executor.transformRequest(model, { model, input: "hello", parallel_tool_calls: true }, true, {}, context);
    expect(make("gpt-5.4").parallel_tool_calls).toBe(false);
    expect(make("gpt-6.1-sol-ultra").parallel_tool_calls).toBe(true);
    expect(make("gpt-5.6-luna-max").parallel_tool_calls).toBe(true);
  });
});

describe("Codex refresh attempt journal", () => {
  it("preserves a proxy transport failure without trying direct egress", async () => {
    const transport = await vi.importActual("../../open-sse/utils/proxyFetch.js");
    const failure = new Error("proxy response lost");
    const proxyFetch = vi.fn().mockRejectedValue(failure);
    const directFetch = vi.fn();
    const proxyUrl = "http://proxy.example.invalid:8080";
    const restore = transport.__setOriginalFetchForTesting(proxyFetch);
    transport.__setProxyDispatcherForTesting(proxyUrl, { dispatch: vi.fn() });
    try {
      await expect(transport.proxyAwareFetch("https://provider.example.invalid/token", {
        method: "POST", body: "grant", directFetch, noTransportReplay: true,
      }, {
        connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, disableEnvProxy: true,
      })).rejects.toBe(failure);
      expect(proxyFetch).toHaveBeenCalledOnce();
      expect(directFetch).not.toHaveBeenCalled();
    } finally {
      restore();
      transport.__clearProxyDispatchersForTesting();
    }
  });

  it.each(["lost response", "ambiguous success"])("guards a %s across translator requests", async (outcome) => {
    const { createProviderConnection, getProviderConnectionById, updateProviderConnection, deleteProviderConnection } =
      await import("../../src/lib/db/repos/connectionsRepo.js");
    const { POST } = await import("../../src/app/api/translator/send/route.js");
    const create = (suffix, active) => createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: `${outcome.replace(" ", "-")}-${suffix}@example.invalid`,
      accessToken: "old-access",
      refreshToken: `${outcome}-${suffix}-grant`,
      isActive: active,
      providerSpecificData: { workspaceId: suffix },
    });
    const primary = await create("primary", true);
    const sibling = await create("sibling", false);
    const execute = vi.spyOn(CodexExecutor.prototype, "execute").mockImplementation(async ({ credentials }) => ({
      response: new Response(null, { status: credentials.accessToken === "new-access" ? 200 : 401 }),
    }));
    const request = () => POST(new Request("http://localhost/api/translator/send", {
      method: "POST",
      body: JSON.stringify({ provider: "codex", model: "gpt-5.4", body: { input: "hello" } }),
    }));
    fetchMock.mockReset();
    try {
      if (outcome === "lost response") {
        fetchMock.mockRejectedValueOnce(new Error("response lost"));
      } else {
        fetchMock.mockResolvedValueOnce(Response.json({ access_token: "new-access", expires_in: 3600 }));
      }
      expect((await request()).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        noTransportReplay: true,
        redirect: "error",
        signal: expect.any(AbortSignal),
      }), expect.any(Object));
      const saved = await getProviderConnectionById(primary.id);
      expect(saved.refreshToken).toBe(primary.refreshToken);
      expect(saved.providerSpecificData.codexRefreshAttempt).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect((await request()).status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await getProviderConnectionById(sibling.id)).providerSpecificData).not.toHaveProperty("codexRefreshAttempt");

      await updateProviderConnection(primary.id, { isActive: false });
      await updateProviderConnection(sibling.id, { isActive: true });
      fetchMock.mockImplementationOnce(async () => {
        expect((await getProviderConnectionById(sibling.id)).providerSpecificData.codexRefreshAttempt).toBeTruthy();
        return Response.json({ access_token: "new-access", refresh_token: "rotated-grant", expires_in: 3600 });
      });
      expect((await request()).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const rotated = await getProviderConnectionById(sibling.id);
      expect(rotated.refreshToken).toBe("rotated-grant");
      expect(rotated.providerSpecificData).toEqual({ workspaceId: "sibling" });
      expect((await getProviderConnectionById(primary.id)).providerSpecificData.codexRefreshAttempt)
        .toBe(saved.providerSpecificData.codexRefreshAttempt);
    } finally {
      execute.mockRestore();
      fetchMock.mockReset();
      await deleteProviderConnection(primary.id);
      await deleteProviderConnection(sibling.id);
    }
  });
});
