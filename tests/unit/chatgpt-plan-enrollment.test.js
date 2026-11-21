import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createChatGptPlanEnrollment } from "../../src/lib/oauth/chatgptPlanEnrollment.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

const selection = { id: "private-id", issuer: "issuer", subject: "subject", clientId: "client" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(existing = null) {
  const row = { id: "connection", provider: "chatgpt-plan", authType: "oauth", updatedAt: "v1", providerSpecificData: existing ? { chatgptPlanAccount: existing } : {} };
  const result = Promise.withResolvers();
  const cancel = vi.fn();
  const startLoopback = vi.fn(async () => ({ authorizationUrl: "https://example.test/private", result: result.promise, cancel }));
  const accounts = { signOut: vi.fn(async () => ({ revocation: "confirmed" })) };
  const repository = {
    get: vi.fn(async () => row),
    create: vi.fn(async (data) => ({ ...data, id: "new" })),
    bind: vi.fn(async (id, expected, verified, shouldCommit) => {
      if (id !== row.id || expected.snapshot !== JSON.stringify(row) || JSON.stringify(expected.selection) !== JSON.stringify(row.providerSpecificData.chatgptPlanAccount ?? null) || !shouldCommit()) return false;
      row.providerSpecificData.chatgptPlanAccount = verified;
      return true;
    }),
  };
  return { row, result, cancel, startLoopback, accounts, repository, api: createChatGptPlanEnrollment({ accounts, repository, startLoopback }) };
}

describe("private ChatGPT plan enrollment", () => {
  it("creates an ordinary inactive OAuth connection and binds only the verified result to the selected connection", async () => {
    const t = setup();
    expect(await t.api.create("Owner")).toMatchObject({ id: "new", provider: "chatgpt-plan", authType: "oauth", isActive: false });
    const attempt = await t.api.start("connection", "operator");
    expect(t.startLoopback).toHaveBeenCalledWith(t.accounts, { selection: undefined });
    t.result.resolve(selection); await flush();
    expect(t.repository.bind).toHaveBeenCalledWith("connection", { snapshot: JSON.stringify({ id: "connection", provider: "chatgpt-plan", authType: "oauth", updatedAt: "v1", providerSpecificData: {} }), selection: null }, selection, expect.any(Function));
    expect(t.row.providerSpecificData.chatgptPlanAccount).toEqual(selection);
    expect(t.api.status(attempt.attemptId, "operator")).toEqual({ status: "complete" });
    expect(() => t.api.status(attempt.attemptId, "operator")).toThrow();
  });
  it("binds a returning authorization to its stored selection and denies another operator", async () => {
    const t = setup(selection); const attempt = await t.api.start("connection", "operator");
    expect(t.startLoopback).toHaveBeenCalledWith(t.accounts, { selection });
    expect(() => t.api.status(attempt.attemptId, "other")).toThrow();
    expect(() => t.api.cancel(attempt.attemptId, "other")).toThrow();
    t.result.resolve(selection); await flush();
    expect(t.api.status(attempt.attemptId, "operator").status).toBe("complete");
    expect(await t.api.signOut("connection", false)).toEqual({ revocation: "confirmed" });
    expect(t.accounts.signOut).toHaveBeenCalledWith(selection, { localOnly: false });
  });
  it("fails closed for stale connection edits and cancellation even after callback begins", async () => {
    const t = setup(); const attempt = await t.api.start("connection", "operator");
    t.row.updatedAt = "v2"; t.result.resolve(selection); await flush();
    expect(t.api.status(attempt.attemptId, "operator").status).toBe("failed");
    expect(t.row.providerSpecificData.chatgptPlanAccount).toBeUndefined();
    const u = setup(); const cancelled = await u.api.start("connection", "operator");
    u.api.cancel(cancelled.attemptId, "operator"); u.result.resolve(selection); await flush();
    expect(u.cancel).toHaveBeenCalledOnce();
    expect(u.row.providerSpecificData.chatgptPlanAccount).toBeUndefined();
    expect(() => u.api.status(cancelled.attemptId, "operator")).toThrow();
  });
  it("redacts credentials and the private reference from client DTOs", () => {
    const dto = sanitizeProviderConnectionForClient({ id: "c", provider: "chatgpt-plan", accessToken: "secret", refreshToken: "secret", idToken: "secret", providerSpecificData: { chatgptPlanAccount: selection } });
    expect(JSON.stringify(dto)).not.toMatch(/secret|private-id|subject|client/);
    for (const path of ["../../src/lib/providerRouteHandlers.js", "../../src/app/api/providers/[id]/route.js"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain('"chatgptPlanAccount"');
      expect(source).toContain('Object.hasOwn(');
    }
  });
  it("requires an explicitly enabled authenticated local operator and documents VM boundaries", () => {
    const route = readFileSync(new URL("../../src/app/api/oauth/chatgpt-plan/enrollment/route.js", import.meta.url), "utf8");
    expect(route).toContain('DURINDOOR_CHATGPT_PLAN_ENROLLMENT !== "1"');
    expect(route).toContain("!isLocalRequest(request)");
    expect(route).toContain("!await hasValidToken(request)");
    expect(route).toContain("hasExactRequestOrigin(request)");
    const docs = readFileSync(new URL("../../internal/docs/chatgpt-plan-oauth.md", import.meta.url), "utf8");
    expect(docs).toContain("detachForVm(selection)");
    expect(docs).toContain("authenticated secure channel");
    expect(docs).toContain("DURINDOOR_CHATGPT_PLAN_ENROLLMENT");
  });
});

describe("enrollment HTTP guard", () => {
  it("denies unauthenticated, remote and disabled requests before opening the service", async () => {
    vi.resetModules();
    const guard = { hasValidCliToken: vi.fn(async () => false), hasValidToken: vi.fn(async () => false), isLocalRequest: vi.fn(() => true) };
    const registry = [];
    vi.doMock("open-sse/providers/registry/index.js", () => ({ default: registry }));
    vi.doMock("@/dashboardGuard", () => guard);
    vi.doMock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: () => true }));
    const api = { create: vi.fn(async () => ({ id: "new" })), start: vi.fn(async () => ({ attemptId: "attempt", authorizationUrl: "https://example.test/private" })) };
    const createAccounts = vi.fn(() => ({}));
    const createEnrollment = vi.fn(() => api);
    vi.doMock("@/lib/oauth/chatgptPlanAccounts", () => ({ createChatGptPlanAccounts: createAccounts }));
    vi.doMock("@/lib/oauth/chatgptPlanEnrollment", () => ({ createChatGptPlanEnrollment: createEnrollment }));
    const { POST } = await import("../../src/app/api/oauth/chatgpt-plan/enrollment/route.js");
    const request = { headers: new Headers(), cookies: { get: () => undefined }, json: async () => ({ action: "create", name: "x" }) };
    vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "1");
    guard.hasValidToken.mockResolvedValue(true);
    request.cookies.get = () => ({ value: "synthetic-session" });
    const denied = await POST(request);
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ error: "Not found" });
    expect(createAccounts).not.toHaveBeenCalled();
    expect(createEnrollment).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    registry.push({ id: "chatgpt-plan" });
    guard.hasValidToken.mockResolvedValue(false);
    expect((await POST(request)).status).toBe(401);
    guard.hasValidToken.mockResolvedValue(true);
    request.cookies.get = () => ({ value: "synthetic-session" });
    request.json = async () => ({ action: "start", connectionId: "one", selection });
    expect((await POST(request)).status).toBe(400);
    request.json = async () => ({ action: "start", connectionId: "one", chatgptPlanAccount: selection });
    expect((await POST(request)).status).toBe(400);
    request.json = async () => ({ action: "create", name: "Owner" });
    expect(await (await POST(request)).json()).toEqual({ connectionId: "new" });
    request.json = async () => ({ action: "start", connectionId: "new" });
    expect(await (await POST(request)).json()).toEqual({ attemptId: "attempt", authorizationUrl: "https://example.test/private" });
    expect(api.start).toHaveBeenCalledWith("new", expect.any(String));
    guard.isLocalRequest.mockReturnValue(false);
    expect((await POST(request)).status).toBe(404);
    guard.isLocalRequest.mockReturnValue(true);
    vi.stubEnv("DURINDOOR_CHATGPT_PLAN_ENROLLMENT", "0");
    expect((await POST(request)).status).toBe(404);
    vi.unstubAllEnvs(); vi.doUnmock("open-sse/providers/registry/index.js"); vi.doUnmock("@/dashboardGuard"); vi.doUnmock("@/lib/auth/requestOrigin"); vi.doUnmock("@/lib/oauth/chatgptPlanAccounts"); vi.doUnmock("@/lib/oauth/chatgptPlanEnrollment");
  });
});

describe("repository selection compare-and-set", () => {
  it("binds the selected saved OAuth connection and rejects stale snapshots", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "plan-binding-test-"));
    vi.stubEnv("DATA_DIR", join(root, "data"));
    vi.stubEnv("HOME", join(root, "home"));
    vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
    for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DURINDOOR_DATABASE_ENV_FILE"]) vi.stubEnv(key, undefined);
    delete globalThis._dbAdapter;
    vi.resetModules();
    try {
      const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
      const first = await repo.createProviderConnection({ provider: "chatgpt-plan", authType: "oauth", name: "one", isActive: false }, { createOnly: true });
      const second = await repo.createProviderConnection({ provider: "chatgpt-plan", authType: "oauth", name: "two", isActive: false }, { createOnly: true });
      const snapshot = await repo.getProviderConnectionById(first.id);
      const expected = { snapshot: JSON.stringify(snapshot), selection: null };
      expect(await repo.compareAndSwapChatGptPlanSelection(first.id, expected, selection)).toBe(true);
      expect((await repo.getProviderConnectionById(first.id)).providerSpecificData.chatgptPlanAccount).toEqual(selection);
      expect((await repo.getProviderConnectionById(second.id)).providerSpecificData?.chatgptPlanAccount).toBeUndefined();
      expect(await repo.compareAndSwapChatGptPlanSelection(first.id, expected, selection)).toBe(false);
      expect(await repo.compareAndSwapChatGptPlanSelection(second.id, expected, selection)).toBe(false);
    } finally {
      await globalThis._dbAdapter?.instance?.close?.();
      delete globalThis._dbAdapter;
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
