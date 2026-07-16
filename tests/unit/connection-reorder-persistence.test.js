// Real repo-level proof that the dashboard Reorder-by-availability persist
// strategy lands the exact desired order (fix for Codex P2 "persist reordered
// priorities atomically"). The UI writes in REVERSE desired order with
// `priority: 0`: every PUT runs `updateProviderConnection` → reorderInTx,
// which resequences priorities to 1..N, so the zero-priority target is
// uniquely smallest and moves strictly to the front. Reverse move-to-front ==
// desired order. (Ascending `priority: idx` and upstream's `Promise.all` can
// interleave reorderInTx and persist a different order.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-reorder-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("reorder-by-availability persist strategy (upstream 9router #2558)", () => {
  it("reverse desired order with priority 0 lands the exact desired order", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { updateProviderConnection, getProviderConnections } = await import(
      "../../src/lib/db/repos/connectionsRepo.js"
    );
    const db = await getAdapter();
    const base = Date.parse("2026-01-05T12:00:00.000Z"); // fixed past date
    ["a", "b", "c", "d"].forEach((id, i) => {
      const ts = new Date(base + i * 1000).toISOString();
      db.run(
        `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, priority, createdAt, updatedAt)
         VALUES(?, 'codex', 'oauth', ?, 1, '{}', ?, ?, ?)`,
        [id, id, (4 - i) * 10, ts, ts],
      );
    });

    const desired = ["c", "a", "d", "b"]; // arbitrary availability-sorted order
    // Mirror the UI handler: reverse desired order, priority: 0 each time.
    for (let i = desired.length - 1; i >= 0; i--) {
      await updateProviderConnection(desired[i], { priority: 0 });
    }

    const persisted = (await getProviderConnections({ provider: "codex" })).map((c) => c.id);
    expect(persisted).toEqual(desired);
    // Real-DB test: 4 sequential transactions through the adapter; exceeds the
    // 5s default when a sibling worker competes for CPU on a loaded host.
  }, 15_000);
});
