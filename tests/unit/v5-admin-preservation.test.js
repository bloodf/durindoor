import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";
import { MEDIA_PROVIDER_KINDS } from "../../src/shared/constants/providers.js";
import { ADMIN_BACKUP_CODES, ADMIN_CLI_IDS, ADMIN_MEDIA_KINDS, ADMIN_MFA_SECRET, ADMIN_PASSWORD, createAdminFixture } from "../../src/shared/ui/v5/preservation/admin-fixtures.js";

async function request(fixture, method, path, payload, password) {
  const handler = fixture.routes[`${method} ${path}`];
  expect(handler, `${method} ${path} must have an explicit isolated fixture`).toBeTypeOf("function");
  return handler(new Request(`https://review.example.test${path}`, {
    method,
    headers: { "content-type": "application/json", ...(password ? { "x-9r-password": password } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }));
}

describe("v5 administration preservation fixtures", () => {
  it("exposes every canonical CLI adapter and media category as a distinct production story", () => {
    const source = readFileSync(new URL("../../src/shared/ui/v5/preservation/Admin.stories.jsx", import.meta.url), "utf8");
    const cliIds = [...source.matchAll(/= cli\("([^"]+)"\)/g)].map((match) => match[1]);
    const kinds = [...source.matchAll(/= media\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(new Set(cliIds)).toEqual(new Set(Object.keys(CLI_TOOLS)));
    expect(cliIds).toHaveLength(ADMIN_CLI_IDS.length);
    expect(new Set(kinds)).toEqual(new Set(MEDIA_PROVIDER_KINDS.map(({ id }) => id)));
    expect(kinds).toHaveLength(ADMIN_MEDIA_KINDS.length);
    expect(source).toContain('<Component {...props} />');
    expect(source).not.toContain("ResourceEditor");
  });

  it("keeps grants unchanged when either privileged catalog read fails", async () => {
    for (const failure of [{ grantsError: true }, { instancesError: true }]) {
      const fixture = createAdminFixture(failure);
      const response = await request(fixture, "GET", failure.grantsError ? "/api/mcp-gateway/keys/review-mcp-key" : "/api/mcp-gateway/instances");
      expect(response.status).toBe(503);
      expect(fixture.snapshot().grants).toEqual(["review-http"]);
      expect(fixture.calls.every((call) => call.method === "GET")).toBe(true);
    }
  });

  it("reopens saved MCP grants and isolates each fixture instance", async () => {
    const fixture = createAdminFixture();
    await request(fixture, "PUT", "/api/mcp-gateway/keys/review-mcp-key", { grants: ["review-http", "review-stdio"] });
    expect((await request(fixture, "GET", "/api/mcp-gateway/keys/review-mcp-key")).body.grants).toEqual(["review-http", "review-stdio"]);
    expect(createAdminFixture().snapshot().grants).toEqual(["review-http"]);
    fixture.reset();
    expect(fixture.snapshot().grants).toEqual(["review-http"]);
    expect(fixture.calls).toEqual([]);
  });

  it("retains HTTP headers and stdio arguments as their production JSON shapes", async () => {
    const fixture = createAdminFixture();
    await request(fixture, "PUT", "/api/mcp-gateway/instances/review-http", { headers: { "X-Review": "true" }, providerConnectionId: "review-openai" });
    await request(fixture, "PUT", "/api/mcp-gateway/instances/review-stdio", { args: ["--changed"], env: { REVIEW_ONLY: "changed" } });
    const instances = (await request(fixture, "GET", "/api/mcp-gateway/instances")).body.instances;
    expect(instances.find(({ transport }) => transport === "http")).toMatchObject({ headers: { "X-Review": "true" }, providerConnectionId: "review-openai" });
    expect(instances.find(({ transport }) => transport === "stdio")).toMatchObject({ args: ["--changed"], env: { REVIEW_ONLY: "changed" } });
  });

  it("rejects unauthorized engine changes and retains a rollback snapshot after cutover", async () => {
    const fixture = createAdminFixture();
    expect((await request(fixture, "POST", "/api/settings/database/cutover", {}, "wrong")).status).toBe(401);
    expect(fixture.snapshot().engine.activeEngine).toBe("sqlite");
    await request(fixture, "POST", "/api/settings/database/test", { url: "postgres://review@db.example.test/review", persist: true }, ADMIN_PASSWORD);
    expect(fixture.snapshot().testedUrl).toBe("postgres://review@db.example.test/review");
    await request(fixture, "POST", "/api/settings/database/cutover", {}, ADMIN_PASSWORD);
    expect(fixture.snapshot().engine).toMatchObject({ activeEngine: "postgres", snapshots: [{ id: "review-snapshot" }] });
    expect((await request(fixture, "POST", "/api/settings/database/rollback", {}, ADMIN_PASSWORD)).status).toBe(400);
    await request(fixture, "POST", "/api/settings/database/rollback", { force: true }, ADMIN_PASSWORD);
    expect(fixture.snapshot().engine.activeEngine).toBe("sqlite");
    expect(fixture.calls.at(-1)).toMatchObject({ password: ADMIN_PASSWORD, payload: { force: true } });
  });

  it("keeps a rejected cutover on the original engine", async () => {
    const fixture = createAdminFixture({ databaseError: true });
    expect((await request(fixture, "POST", "/api/settings/database/cutover", {}, ADMIN_PASSWORD)).status).toBe(503);
    expect(fixture.snapshot().engine.activeEngine).toBe("sqlite");
  });

  it("requires MFA setup proof before enabling and supports a backup-code disable request", async () => {
    const fixture = createAdminFixture();
    expect((await request(fixture, "POST", "/api/auth/mfa/setup", { password: "wrong" })).status).toBe(401);
    const setup = await request(fixture, "POST", "/api/auth/mfa/setup", { password: ADMIN_PASSWORD });
    expect(setup.body.secret).toBe(ADMIN_MFA_SECRET);
    expect(fixture.snapshot().settings.mfaEnabled).toBe(false);
    expect((await request(fixture, "POST", "/api/auth/mfa/enable", { password: ADMIN_PASSWORD, secret: ADMIN_MFA_SECRET, code: "000000" })).status).toBe(400);
    const enabled = await request(fixture, "POST", "/api/auth/mfa/enable", { password: ADMIN_PASSWORD, secret: ADMIN_MFA_SECRET, code: "123456" });
    expect(enabled.body.backupCodes).toEqual(ADMIN_BACKUP_CODES);
    expect(fixture.snapshot().settings).toMatchObject({ mfaEnabled: true, mfaBackupCodesRemaining: 2 });
    await request(fixture, "POST", "/api/auth/mfa/disable", { password: ADMIN_PASSWORD, code: ADMIN_BACKUP_CODES[0] });
    expect(fixture.snapshot().settings).toMatchObject({ mfaEnabled: false, mfaBackupCodesRemaining: 0 });
  });

  it("keeps rejected and challenge auth branches inside the preview", async () => {
    for (const [login, expected] of [["mfa", { mfaRequired: true }], ["change", { proof: "review-proof", requiresPasswordChange: true }], ["remote", { mustChangePassword: true }], ["locked", { retryAfter: 2 }]]) {
      const fixture = createAdminFixture({ login });
      expect((await request(fixture, "POST", "/api/auth/login", { password: ADMIN_PASSWORD })).body).toMatchObject(expected);
      expect((await request(fixture, "GET", "/api/auth/status")).body.authenticated).toBe(false);
      expect((await request(fixture, "POST", "/api/auth/mfa/verify", { code: ADMIN_BACKUP_CODES[0] })).status).toBe(401);
    }
  });

  it("returns isolated success responses without authenticating the host or registering a live OIDC route", async () => {
    const fixture = createAdminFixture({ login: "success", mfaSuccess: true });
    expect((await request(fixture, "POST", "/api/auth/login", { password: ADMIN_PASSWORD })).body).toEqual({ success: true });
    expect((await request(fixture, "POST", "/api/auth/mfa/verify", { code: "123456" })).body).toEqual({ success: true });
    expect((await request(fixture, "GET", "/api/auth/status")).body.authenticated).toBe(false);
    expect(fixture.routes).not.toHaveProperty("GET /api/auth/oidc/start");
  });

  it("retains custom System One nodes and separate MITM model mappings through refresh", async () => {
    const fixture = createAdminFixture();
    const node = { type: "systemone-compatible", name: "Review System One", prefix: "review-systemone", baseUrl: "https://systemone.example.test/v1" };
    const created = await request(fixture, "POST", "/api/provider-nodes", node);
    expect((await request(fixture, "GET", "/api/provider-nodes")).body.nodes).toEqual([{ ...node, id: created.body.node.id }]);
    const mappings = { "claude-sonnet-4": { model: "openai/gpt-4.1" } };
    await request(fixture, "PUT", "/api/cli-tools/antigravity-mitm/alias", { tool: "kiro", mappings });
    expect(fixture.snapshot().aliases).toEqual({ kiro: mappings });
    expect(fixture.snapshot().mitm.dnsStatus).toEqual({ antigravity: true, kiro: false });
    fixture.reset();
    expect(fixture.snapshot().nodes).toEqual([]);
    expect(fixture.snapshot().aliases).toEqual({});
  });

  it("persists settings and imported payloads while recording exact password boundaries", async () => {
    const fixture = createAdminFixture();
    await request(fixture, "PATCH", "/api/settings", { oidcClientId: "changed-review-client", dataRetentionDays: 90 });
    expect((await request(fixture, "GET", "/api/settings")).body).toMatchObject({ oidcClientId: "changed-review-client", dataRetentionDays: 90, hasOidcClientSecret: true });
    expect((await request(fixture, "GET", "/api/settings/database", undefined, "wrong")).status).toBe(401);
    expect((await request(fixture, "POST", "/api/settings/database", { password: "wrong", settings: {} })).status).toBe(401);
    expect(fixture.snapshot().imports).toEqual([]);
    await request(fixture, "POST", "/api/settings/database", { password: ADMIN_PASSWORD, settings: { theme: "dark" } });
    expect(fixture.snapshot().imports).toEqual([{ password: ADMIN_PASSWORD, settings: { theme: "dark" } }]);
  });

  it("keeps MITM certificate, lifecycle and tool DNS state separate", async () => {
    const fixture = createAdminFixture({ mitmRunning: false, mitm: { certTrusted: false }, portConflict: true });
    expect((await request(fixture, "POST", "/api/cli-tools/antigravity-mitm", { forceKillPort443: false })).status).toBe(409);
    expect(fixture.snapshot().mitm.running).toBe(false);
    await request(fixture, "PATCH", "/api/cli-tools/antigravity-mitm", { action: "trust-cert", sudoPassword: "" });
    await request(fixture, "POST", "/api/cli-tools/antigravity-mitm", { forceKillPort443: true });
    await request(fixture, "PATCH", "/api/cli-tools/antigravity-mitm", { tool: "kiro", action: "enable", sudoPassword: "" });
    expect(fixture.snapshot().mitm).toMatchObject({ running: true, certTrusted: true, dnsStatus: { antigravity: true, kiro: true } });
    await request(fixture, "DELETE", "/api/cli-tools/antigravity-mitm", { sudoPassword: "" });
    expect(fixture.snapshot().mitm).toMatchObject({ running: false, certTrusted: true });
  });

  it("reads, writes and resets every custom CLI fixture without changing other clients", async () => {
    const fixture = createAdminFixture();
    for (const toolId of ADMIN_CLI_IDS) {
      const path = `/api/cli-tools/${toolId}-settings`;
      await request(fixture, "POST", path, { model: "openai/review-model", baseUrl: "http://localhost:20128/v1" });
      expect((await request(fixture, "GET", path)).body.model).toBe("openai/review-model");
      await request(fixture, "DELETE", path, {});
      expect((await request(fixture, "GET", path)).body.has9Router).toBe(false);
    }
  });
});
