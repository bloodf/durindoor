/**
 * durindoor#2313: the proactive/background refresh stack must not overwrite a
 * newer stored refresh token, and must not persist malformed refresh fields.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeRefreshedCredentials } from "../../open-sse/services/oauthCredentialManager.js";

const mocks = vi.hoisted(() => ({ refreshProviderCredentials: vi.fn() }));

vi.mock("../../open-sse/services/oauthCredentialManager.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshProviderCredentials: mocks.refreshProviderCredentials };
});

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let repo;
let wrapper;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-persist-2313-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  wrapper = await import("../../src/sse/services/tokenRefresh.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
async function createConnection() {
  sequence += 1;
  return repo.createProviderConnection({
    provider: "claude",
    authType: "oauth",
    email: `user${sequence}@example.com`,
    accessToken: "A0",
    refreshToken: "R0",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

describe("proactive refresh persistence guard", () => {
  it("keeps a rotation that landed while this refresh was in flight", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockImplementationOnce(async () => {
      await repo.updateProviderConnection(connection.id, { accessToken: "A-winner", refreshToken: "R-winner" });
      return { accessToken: "A-late", refreshToken: "R-late", expiresIn: 3600 };
    });

    const result = await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    const stored = await repo.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ accessToken: "A-winner", refreshToken: "R-winner" });
    // The request still gets the access token the provider just issued.
    expect(result.accessToken).toBe("A-late");
  });

  it("persists a rotation when the stored refresh token is the one presented", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockResolvedValueOnce({ accessToken: "A1", refreshToken: "R1", expiresIn: 3600 });

    await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await repo.getProviderConnectionById(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
  });

  it("persists when the exchange already stored the replacement refresh token", async () => {
    const connection = await createConnection();
    mocks.refreshProviderCredentials.mockImplementationOnce(async () => {
      await repo.updateProviderConnection(connection.id, { refreshToken: "R1" });
      return { accessToken: "A1", refreshToken: "R1", expiresIn: 3600 };
    });

    await wrapper.checkAndRefreshToken("claude", { ...connection }, null, { force: true });

    expect(await repo.getProviderConnectionById(connection.id)).toMatchObject({ accessToken: "A1", refreshToken: "R1" });
  });
});

describe("refresh persist field validation", () => {
  it.each([
    ["an unparsable expiresAt", { expiresAt: "soon" }],
    ["a non-numeric expiresIn", { expiresIn: "soon" }],
    ["a negative expiresIn", { expiresIn: -5 }],
  ])("saves the rotated token and keeps the stored expiry for %s", async (_label, expiry) => {
    const connection = await createConnection();

    const applied = await wrapper.updateProviderCredentials(connection.id, { refreshToken: "R1", ...expiry });

    expect(applied).toBe(true);
    const stored = await repo.getProviderConnectionById(connection.id);
    expect(stored.refreshToken).toBe("R1");
    expect(stored.expiresAt).toBe(connection.expiresAt);
  });

  it("falls back to a valid expiresAt when expiresIn is unusable", async () => {
    const connection = await createConnection();
    const expiresAt = Date.now() + 7200_000;

    await wrapper.updateProviderCredentials(connection.id, { accessToken: "A1", expiresIn: "soon", expiresAt: String(expiresAt) });

    expect((await repo.getProviderConnectionById(connection.id)).expiresAt).toBe(new Date(expiresAt).toISOString());
  });

  it("drops malformed secrets and refresh times but keeps valid fields", async () => {
    const connection = await createConnection();

    await wrapper.updateProviderCredentials(connection.id, {
      accessToken: { token: "A1" },
      refreshToken: "R1\r\nX-Injected: 1",
      idToken: "I1",
      lastRefreshAt: "yesterday-ish",
    });

    const stored = await repo.getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ accessToken: "A0", refreshToken: "R0", idToken: "I1" });
    expect(stored.lastRefreshAt ?? null).toBeNull();
  });

  it("does not throw away a rotation when a provider reports an unusable lifetime", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");

    const merged = mergeRefreshedCredentials("test", {}, { accessToken: "A1", refreshToken: "R1", expiresIn: "soon" }, now);

    expect(merged).toMatchObject({ accessToken: "A1", refreshToken: "R1", expiresAt: new Date(now + 3600_000).toISOString() });
    expect(merged).not.toHaveProperty("expiresIn");
  });
});
