import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { exchangeCodexCode } from "../../src/lib/oauth/providerParity/codex/index.js";
import { codexWorkspaceFromMeta, requireCodexWorkspace } from "../../src/lib/oauth/codexWorkspace.js";
import { normalizeCodexImportRecord } from "../../src/lib/oauth/codexImportRecord.js";
import { createChatGptPlanProtocol, startChatGptPlanAuthorization } from "../../src/lib/oauth/chatgptPlanProtocol.js";

const config = { clientId: "synthetic-client", tokenUrl: "https://auth.openai.com/oauth/token" };
const redirect = "http://localhost:1455/auth/callback";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Codex workspace and CLI import production contracts", () => {
  it.each(["workspace-x", "workspace-01", "fff", "team\\name"])("accepts printable workspace %s", (id) => {
    expect(codexWorkspaceFromMeta({ allowed_workspace_id: id })).toBe(id);
  });
  it.each(["team\u0000id", "team\u001fid", "team\u007fid", "team\nid", 123, " "])("rejects malformed workspace %j", (id) => {
    expect(() => codexWorkspaceFromMeta({ workspace_id: id })).toThrow("Invalid Codex workspace");
  });
  it("rejects conflicting selectors and a token for another account", () => {
    expect(() => codexWorkspaceFromMeta({ workspace_id: "a", expectedWorkspaceId: "b" })).toThrow("Conflicting");
    const token = `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "a" } })).toString("base64url")}.synthetic`;
    expect(() => requireCodexWorkspace(token, "a")).not.toThrow();
    expect(() => requireCodexWorkspace(token, "b")).toThrow("selected workspace");
  });
  it("keeps two imported account credentials separate and strips the unrelated API key", () => {
    const records = ["a", "b"].map((id) => ({
      OPENAI_API_KEY: "synthetic-api-key", auth_mode: "chatgpt",
      tokens: { access_token: `access-${id}`, refresh_token: `refresh-${id}`, account_id: id },
    }));
    const before = JSON.stringify(records);
    const imported = records.map(normalizeCodexImportRecord);
    expect(imported.map((row) => [row.accessToken, row.refreshToken, row.providerSpecificData.chatgptAccountId]))
      .toEqual([["access-a", "refresh-a", "a"], ["access-b", "refresh-b", "b"]]);
    expect(JSON.stringify(imported)).not.toContain("synthetic-api-key");
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe("Codex exchange transport contract", () => {
  it("preserves concurrent client, verifier and proxy identity with one submission each", async () => {
    const transport = vi.fn(async (_url, init) => ({ ok: true, json: async () => ({ access_token: new URLSearchParams(init.body).get("code") }) }));
    vi.stubGlobal("fetch", transport);
    const proxies = [{ proxyUrl: "http://proxy-a.invalid" }, { proxyUrl: "http://proxy-b.invalid" }];
    const result = await Promise.all(["a", "b"].map((id, i) => exchangeCodexCode({ ...config, clientId: id }, id, redirect, `verifier-${id}`, "state", {}, proxies[i])));
    expect(result.map((row) => row.access_token)).toEqual(["a", "b"]);
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mock.calls.forEach(([, init], i) => {
      const id = ["a", "b"][i];
      expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ grant_type: "authorization_code", client_id: id, code: id, redirect_uri: redirect, code_verifier: `verifier-${id}` });
      expect(init.proxyOptions).toBe(proxies[i]);
      expect(init.redirect).toBe("error");
    });
  });
  it.each([400, 401, 403, 429, 500])("rejects HTTP %s without reading or exposing a body or resubmitting", async (status) => {
    const body = vi.fn(() => { throw new Error("synthetic-secret"); });
    const transport = vi.fn(async () => ({ ok: false, status, text: body, json: body }));
    vi.stubGlobal("fetch", transport);
    await expect(exchangeCodexCode(config, "code", redirect, "verifier")).rejects.toThrow(/^Codex token exchange failed$/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveBeenCalled();
  });
  it("rejects missing PKCE before transport and scrubs malformed accepted responses", async () => {
    const transport = vi.fn(async () => ({ ok: true, json: async () => ({ error: "synthetic-secret" }) }));
    vi.stubGlobal("fetch", transport);
    await expect(exchangeCodexCode(config, "code", redirect, "")).rejects.toThrow("Invalid");
    expect(transport).not.toHaveBeenCalled();
    await expect(exchangeCodexCode(config, "code", redirect, "verifier")).rejects.toThrow(/^Codex token exchange failed$/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("forwards caller cancellation without retrying a submitted code", async () => {
    const controller = new AbortController();
    const transport = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("synthetic-secret")), { once: true });
    }));
    vi.stubGlobal("fetch", transport);
    const pending = exchangeCodexCode(config, "code", redirect, "verifier", null, null, {}, controller.signal);
    const assertion = expect(pending).rejects.toThrow(/^Codex token exchange failed$/);
    controller.abort();
    await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("ChatGPT plan production protocol rejection", () => {
  it("rejects expired authorization before transport using a fake clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const { attempt } = startChatGptPlanAuthorization({ redirectUri: "http://127.0.0.1:1455/auth/callback", hostId: "synthetic-host" });
    const transport = vi.fn();
    const protocol = createChatGptPlanProtocol({ fetchAdapter: transport });
    vi.advanceTimersByTime(600_000);
    await expect(protocol.exchangeCode(attempt, `${attempt.redirectUri}?state=${attempt.state}&code=synthetic&client_id=oaiapp_synthetic`)).rejects.toThrow("invalid_callback");
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses the account's issued client on refresh and suppresses rejected token contents", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", detail: "synthetic-secret" }), { status: 401 }));
    const protocol = createChatGptPlanProtocol({ fetchAdapter: transport });
    await expect(protocol.refresh({ issuer: "https://auth.openai.com", clientId: "oaiapp_selected", subject: "selected", refreshToken: "synthetic-refresh" })).rejects.toThrow("invalid_grant (HTTP 401)");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].body.get("client_id")).toBe("oaiapp_selected");
    expect(transport.mock.calls[0][1].body.get("resource")).toBe("https://api.openai.com/v1");
  });
});

// Staging-only registration assertions: replace this block when the auth batch registers the helper.
describe("ordered web registration", () => {
  it("records the existing exchange slot and preserves centralized flow ownership", () => {
    const registration = JSON.parse(readFileSync(new URL("../../src/lib/oauth/providerParity/codex/registration.json", import.meta.url), "utf8"));
    expect(registration.status).toBe("staged");
    expect(registration.exports).toContain("exchangeCodexCode");
    expect(registration.integrationSlots).toContainEqual(expect.objectContaining({ symbol: "codex.exchangeToken" }));
  });
});
