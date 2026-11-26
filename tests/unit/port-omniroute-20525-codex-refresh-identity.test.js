import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => ({ next: null }));
vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshProviderCredentials: vi.fn(async () => refresh.next),
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir, db, tokenRefresh, providerCredentials, sequence = 0;

const jwt = (user, account = `account-${user}`, extra = {}) => `e30.${Buffer.from(JSON.stringify({
  sub: user, "https://api.openai.com/auth": { chatgpt_user_id: user, chatgpt_account_id: account }, ...extra,
})).toString("base64url")}.synthetic-signature`;
const OWNER = jwt("user-a", "account-a");
const ROTATED = jwt("user-a", "account-a", { jti: "next" });
const FOREIGN = jwt("user-b", "account-b");

async function connect() {
  sequence += 1;
  return db.createProviderConnection({
    provider: "codex", authType: "oauth", name: `identity-${sequence}`, email: `identity-${sequence}@example.test`,
    accessToken: OWNER, refreshToken: "original-refresh", idToken: OWNER, isActive: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    providerSpecificData: { workspaceId: "account-a", workspaceStructure: "personal" },
  });
}

async function expectUnchanged(id) {
  expect(await db.getProviderConnectionById(id)).toMatchObject({ accessToken: OWNER, refreshToken: "original-refresh", idToken: OWNER });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-codex-identity-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  tokenRefresh = await import("../../src/sse/services/tokenRefresh.js");
  providerCredentials = await import("../../src/shared/services/providerCredentials.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("OmniRoute #20525 Codex refresh keeps the connection's account identity", () => {
  it.each([
    ["another user's access token", { accessToken: FOREIGN, refreshToken: "foreign-refresh" }],
    ["another user's ID token", { accessToken: "opaque-access", idToken: FOREIGN, refreshToken: "foreign-refresh" }],
  ])("does not persist %s", async (_label, rotated) => {
    const connection = await connect();
    await expect(tokenRefresh.updateProviderCredentials(connection.id, rotated)).resolves.toBe(false);
    await expectUnchanged(connection.id);
  });

  it.each([["a matching", ROTATED], ["an opaque", "opaque-access"]])("persists %s access token", async (_label, accessToken) => {
    const connection = await connect();
    await expect(tokenRefresh.updateProviderCredentials(connection.id, { accessToken, refreshToken: "next-refresh" })).resolves.toBe(true);
    expect(await db.getProviderConnectionById(connection.id)).toMatchObject({ accessToken, refreshToken: "next-refresh" });
  });

  it("keeps the stored credential through the shared refresh coordinator", async () => {
    const connection = await connect();
    const executor = { refreshCredentials: async () => ({ accessToken: FOREIGN, refreshToken: "foreign-refresh" }) };
    const result = await providerCredentials.refreshAndUpdateCredentials(connection, true, null, { getExecutorImpl: () => executor });
    expect(result.refreshed).toBe(false);
    expect(result.connection.accessToken).toBe(OWNER);
    await expectUnchanged(connection.id);
  });

  it.each(["codex", undefined])("never dispatches the foreign token after a proactive refresh (credentials.provider: %s)", async (provider) => {
    const connection = await connect();
    refresh.next = { accessToken: FOREIGN, refreshToken: "foreign-refresh" };
    const credentials = {
      provider, connectionId: connection.id, authType: "oauth", accessToken: OWNER, refreshToken: "original-refresh",
      idToken: OWNER, providerSpecificData: connection.providerSpecificData,
    };
    const result = await tokenRefresh.checkAndRefreshToken("codex", credentials, null, { force: true });
    expect(result.accessToken).toBe(OWNER);
    await expectUnchanged(connection.id);
  });
});
