import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-auto-ping-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function createOAuth(provider, email) {
  return db.createProviderConnection({
    provider,
    authType: "oauth",
    email,
    accessToken: `token-${email}`,
  });
}

describe("connection-scoped auto-ping persistence", () => {
  it("preserves config fields and concurrent sibling toggles", async () => {
    const first = await createOAuth("claude", "first@example.com");
    const second = await createOAuth("claude", "second@example.com");
    await db.updateSettings({
      claudeAutoPing: { enabled: true, description: "preserve-me", connections: {} },
    });

    await Promise.all([
      db.setProviderConnectionAutoPing(first.id, true),
      db.setProviderConnectionAutoPing(second.id, true),
    ]);

    const settings = await db.getSettings();
    expect(settings.claudeAutoPing).toMatchObject({
      enabled: true,
      description: "preserve-me",
      connections: { [first.id]: true, [second.id]: true },
    });
  });

  it("removes disabled entries instead of persisting false tombstones", async () => {
    const connection = await createOAuth("codex", "disable@example.com");
    await db.setProviderConnectionAutoPing(connection.id, true);

    const result = await db.setProviderConnectionAutoPing(connection.id, false);

    expect(result).toMatchObject({ provider: "codex", enabled: false });
    expect((await db.getSettings()).codexAutoPing.connections).not.toHaveProperty(connection.id);
  });

  it("prunes entries atomically when a connection is disabled or deleted", async () => {
    const disabled = await createOAuth("claude", "inactive@example.com");
    const deleted = await createOAuth("claude", "deleted@example.com");
    const sibling = await createOAuth("claude", "sibling@example.com");
    await Promise.all([disabled, deleted, sibling].map((connection) => (
      db.setProviderConnectionAutoPing(connection.id, true)
    )));

    await db.updateProviderConnection(disabled.id, { isActive: false });
    await db.deleteProviderConnection(deleted.id);

    const connections = (await db.getSettings()).claudeAutoPing.connections;
    expect(connections).not.toHaveProperty(disabled.id);
    expect(connections).not.toHaveProperty(deleted.id);
    expect(connections).toHaveProperty(sibling.id, true);
  });

  it("prunes all matching entries during provider bulk deletion", async () => {
    const first = await createOAuth("codex", "bulk-first@example.com");
    const second = await createOAuth("codex", "bulk-second@example.com");
    await Promise.all([first, second].map((connection) => (
      db.setProviderConnectionAutoPing(connection.id, true)
    )));

    expect(await db.deleteProviderConnectionsByProvider("codex")).toBeGreaterThanOrEqual(2);
    const connections = (await db.getSettings()).codexAutoPing.connections;
    expect(connections).not.toHaveProperty(first.id);
    expect(connections).not.toHaveProperty(second.id);
  });

  it("rejects unsupported, API-key, inactive, missing, and non-boolean mutations", async () => {
    const unsupported = await createOAuth("gemini", "unsupported@example.com");
    const apiKey = await db.createProviderConnection({
      provider: "claude", authType: "apikey", name: "key", apiKey: "secret",
    });
    const inactive = await createOAuth("claude", "inactive-toggle@example.com");
    await db.updateProviderConnection(inactive.id, { isActive: false });

    await expect(db.setProviderConnectionAutoPing(unsupported.id, true)).rejects.toMatchObject({ code: "AUTO_PING_INELIGIBLE" });
    await expect(db.setProviderConnectionAutoPing(apiKey.id, true)).rejects.toMatchObject({ code: "AUTO_PING_INELIGIBLE" });
    await expect(db.setProviderConnectionAutoPing(inactive.id, true)).rejects.toMatchObject({ code: "AUTO_PING_INELIGIBLE" });
    await expect(db.setProviderConnectionAutoPing(inactive.id, false)).resolves.toMatchObject({
      connectionId: inactive.id,
      enabled: false,
    });
    await expect(db.setProviderConnectionAutoPing("missing", true)).resolves.toBeNull();
    await expect(db.setProviderConnectionAutoPing(unsupported.id, "true")).rejects.toBeInstanceOf(TypeError);
  });

  it("stores an anchored schedule beside the reactive flag and prunes it on disable/delete", async () => {
    const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
    const kept = await createOAuth("codex", "schedule-kept@example.com");
    const disabled = await createOAuth("codex", "schedule-disabled@example.com");
    const deleted = await createOAuth("codex", "schedule-deleted@example.com");

    await db.setProviderConnectionAutoPing(kept.id, true);
    await expect(db.setProviderConnectionAutoPing(kept.id, undefined, schedule)).resolves.toMatchObject({ enabled: true, schedule });
    await Promise.all([disabled, deleted].map((connection) => db.setProviderConnectionAutoPing(connection.id, undefined, schedule)));
    await db.updateProviderConnection(disabled.id, { isActive: false });
    await db.deleteProviderConnection(deleted.id);

    const config = (await db.getSettings()).codexAutoPing;
    expect(config.connections).toHaveProperty(kept.id, true);
    expect(config.schedules).toEqual(expect.objectContaining({ [kept.id]: schedule }));
    expect(config.schedules).not.toHaveProperty(disabled.id);
    expect(config.schedules).not.toHaveProperty(deleted.id);

    await expect(db.setProviderConnectionAutoPing(kept.id, undefined, null)).resolves.toMatchObject({ enabled: true, schedule: null });
    expect((await db.getSettings()).codexAutoPing.schedules).not.toHaveProperty(kept.id);
    await expect(db.setProviderConnectionAutoPing(disabled.id, undefined, schedule)).rejects.toMatchObject({ code: "AUTO_PING_INELIGIBLE" });
  });

  it("keeps the stored schedule when the flag is toggled without a schedule", async () => {
    const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
    const conn = await createOAuth("codex", "schedule-toggle@example.com");
    await db.setProviderConnectionAutoPing(conn.id, undefined, schedule);
    await expect(db.setProviderConnectionAutoPing(conn.id, true)).resolves.toMatchObject({ enabled: true, schedule });
    expect((await db.getSettings()).codexAutoPing.schedules).toHaveProperty(conn.id, schedule);
  });

  it("claims a ping marker atomically (compare-and-set)", async () => {
    const conn = await createOAuth("codex", "claim@example.com");
    await expect(db.claimProviderConnectionPing(conn.id, { lastPingedSlotKey: undefined }, { lastPingedSlotKey: "k1" })).resolves.toBe(true);
    await expect(db.claimProviderConnectionPing(conn.id, { lastPingedSlotKey: undefined }, { lastPingedSlotKey: "k1" })).resolves.toBe(false);
    await expect(db.claimProviderConnectionPing(conn.id, { lastPingedSlotKey: "k1" }, { lastPingedSlotKey: "k2" })).resolves.toBe(true);
    expect((await db.getProviderConnectionById(conn.id)).lastPingedSlotKey).toBe("k2");
  });
});
