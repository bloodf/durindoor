import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), update: vi.fn(), fetch: vi.fn(), proxyFetch: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ status: init?.status || 200, body }) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.create, getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update, getProxyPoolById: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyFetch, default: vi.fn() }));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: vi.fn(), clearXaiSession: vi.fn(), getCodexSessionStatus: vi.fn(), getXaiSessionStatus: vi.fn(),
  registerCodexSession: vi.fn(), registerXaiSession: vi.fn(), startCodexProxy: vi.fn(), startXaiProxy: vi.fn(),
  stopCodexProxy: vi.fn(), stopXaiProxy: vi.fn()
}));

import { POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";
import { clearOAuthFlowsForTests } from "../../src/lib/oauth/flowStore.js";
import { refreshCodexToken, refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { providerRefreshContext, providerRefreshContextMatches } from "../../src/shared/utils/providerCredentialContext.js";
import { resolveCodexAccountId } from "../../open-sse/shared/codexAccountId.js";

const originalFetch = global.fetch;
const jwt = (id) => `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(id ? { "https://api.openai.com/auth": { chatgpt_account_id: id }, email: "same@example.com" } : {})).toString("base64url")}.sig`;
const response = (payload) => ({ ok: true, json: async () => payload });
const post = (action, body) => POST({ json: async () => body }, { params: Promise.resolve({ provider: "codex", action }) });
const start = (workspace, ownerId) => post("authorize", { ownerId, meta: { allowed_workspace_id: workspace } });
const exchange = (flow, code, meta) => post("exchange", { flowId: flow.flowId, state: flow.state, code, meta });

describe("Codex workspace selection (#1103)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOAuthFlowsForTests();
    global.fetch = mocks.fetch;
    mocks.create.mockImplementation(async (data) => ({ id: "new-connection", ...data }));
  });
  afterEach(() => { global.fetch = originalFetch; clearOAuthFlowsForTests(); });

  it("binds concurrent flows to their own workspace and ignores exchange metadata", async () => {
    const [a, b] = await Promise.all([start("workspace-a", "owner-a"), start("workspace-b", "owner-b")]);
    expect(new URL(a.body.authUrl).searchParams.get("allowed_workspace_id")).toBe("workspace-a");
    expect(new URL(b.body.authUrl).searchParams.get("allowed_workspace_id")).toBe("workspace-b");
    mocks.fetch.mockImplementation(async (_url, init) => response({ access_token: "access", refresh_token: "refresh", expires_in: 3600, id_token: jwt(new URLSearchParams(init.body).get("code") === "code-a" ? "workspace-a" : "workspace-b") }));
    const [doneB, doneA] = await Promise.all([exchange(b.body, "code-b", { allowed_workspace_id: "workspace-a" }), exchange(a.body, "code-a", { allowed_workspace_id: "workspace-b" })]);
    expect([doneA.status, doneB.status]).toEqual([200, 200]);
    expect(mocks.create.mock.calls.map(([data]) => data.providerSpecificData.codexSelectedWorkspaceId).sort()).toEqual(["workspace-a", "workspace-b"]);
  });

  it.each(["other", null])("rejects a mismatched or missing token claim (%s)", async (id) => {
    const flow = await start("workspace-a", "owner-a");
    mocks.fetch.mockResolvedValue(response({ access_token: "access", refresh_token: "refresh", id_token: jwt(id), expires_in: 3600 }));
    expect((await exchange(flow.body, "authorization-code", { allowed_workspace_id: id })).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects invalid workspace IDs and pasted access tokens in selected flows", async () => {
    expect((await start("bad\r\nheader", "owner-a")).status).toBe(400);
    const flow = await start("workspace-a", "owner-a");
    expect((await exchange(flow.body, jwt("workspace-a"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects reconnecting an existing workspace to another account", async () => {
    mocks.get.mockResolvedValue({ id: "existing", provider: "codex", authType: "oauth", providerSpecificData: { chatgptAccountId: "workspace-a" } });
    mocks.fetch.mockResolvedValue(response({ access_token: "access", refresh_token: "refresh", id_token: jwt("workspace-b"), expires_in: 3600 }));
    const flow = await post("authorize", { connectionId: "existing" });
    expect((await exchange(flow.body, "authorization-code")).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects a reconnect if the target workspace changes before the write", async () => {
    mocks.get.mockResolvedValue({ id: "existing", provider: "codex", authType: "oauth", providerSpecificData: { chatgptAccountId: "workspace-a" } });
    mocks.fetch.mockResolvedValue(response({ access_token: "access", refresh_token: "refresh", id_token: jwt("workspace-a"), expires_in: 3600 }));
    mocks.update.mockImplementation(async (_id, _data, options) => ({ applied: options.shouldCommitConnection({ provider: "codex", authType: "oauth", providerSpecificData: { chatgptAccountId: "workspace-b" } }) }));
    const flow = await post("authorize", { connectionId: "existing" });
    expect((await exchange(flow.body, "authorization-code")).status).toBe(409);
  });

  it("preserves the binding during token rotation and rejects a conflicting or empty claim", async () => {
    for (const id of ["workspace-a", "workspace-b", null]) {
      mocks.proxyFetch.mockResolvedValueOnce(response({ access_token: "new-access", refresh_token: "new-refresh", id_token: jwt(id), expires_in: 3600 }));
    }
    expect(await refreshCodexToken("old-a", null, null, null, "workspace-a")).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(await refreshCodexToken("old-b", null, null, null, "workspace-a")).toMatchObject({ error: "unrecoverable_refresh_error" });
    expect(await refreshCodexToken("old-c", null, null, null, "workspace-a")).toMatchObject({ error: "unrecoverable_refresh_error" });
    mocks.proxyFetch.mockResolvedValueOnce(response({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    expect(await refreshCodexToken("old-d", null, null, null, "workspace-a")).toMatchObject({ refreshToken: "new-refresh" });
  });

  it("checks each workspace after a shared refresh and detects a changed binding", async () => {
    mocks.proxyFetch.mockResolvedValueOnce(response({ access_token: "new-access", refresh_token: "new-refresh", id_token: jwt("workspace-a"), expires_in: 3600 }));
    const [a, b] = await Promise.all([
      refreshCodexToken("shared-refresh", null, null, null, "workspace-a"),
      refreshCodexToken("shared-refresh", null, null, null, "workspace-b")
    ]);
    expect(a.refreshToken).toBe("new-refresh");
    expect(b.error).toBe("unrecoverable_refresh_error");
    expect(mocks.proxyFetch).toHaveBeenCalledTimes(1);
    const existing = { provider: "codex", providerSpecificData: { codexSelectedWorkspaceId: "workspace-a" } };
    const context = providerRefreshContext(existing);
    expect(providerRefreshContextMatches({ ...existing, providerSpecificData: { codexSelectedWorkspaceId: "workspace-b" } }, context)).toBe(false);
  });

  it("retains the account binding of an existing connection without a selection marker", async () => {
    mocks.proxyFetch.mockResolvedValueOnce(response({ access_token: "new-access", refresh_token: "new-refresh", id_token: jwt("workspace-b"), expires_in: 3600 }));
    const result = await refreshTokenByProvider("codex", { refreshToken: "legacy-refresh", providerSpecificData: { chatgptAccountId: "workspace-a" } });
    expect(result).toMatchObject({ error: "unrecoverable_refresh_error" });
    expect(resolveCodexAccountId({ chatgptWorkspaceId: "workspace-a" })).toBe("workspace-a");
  });
});
