import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const SOURCE_ID = "codex:wham-usage:v1";
let tempDir;
let previousHome;
let previousDataDir;

beforeEach(() => {
  previousHome = process.env.HOME;
  previousDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-preflight-repo-"));
  process.env.HOME = path.join(tempDir, "home");
  process.env.DATA_DIR = path.join(tempDir, "data");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seedConnection() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const createdAt = new Date(NOW - 60_000).toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
     VALUES('conn', 'codex', 'oauth', 'Codex', 1, '{}', ?, ?)`,
    [createdAt, createdAt],
  );
}

describe("quota preflight persisted fetch backoff", () => {
  it("honors retryAt and re-enables refresh exactly at its boundary", async () => {
    await seedConnection();
    const database = await import("@/lib/db/index.js");
    const { inspectProviderQuota } = await import("@/shared/services/providerQuotaPreflight");
    await database.recordQuotaFetchFailure({
      connectionId: "conn",
      provider: "codex",
      sourceId: SOURCE_ID,
      outcome: "rate_limited",
      attemptedAt: new Date(NOW).toISOString(),
      retryAt: new Date(NOW + 30_000).toISOString(),
      reasonCode: "rate_limited",
    }, { now: NOW });

    const before = await inspectProviderQuota([{ id: "conn" }], {
      provider: "codex",
      resourceKeys: ["model:gpt-5.4"],
      now: NOW + 1_000,
    });
    expect(before.get("conn")).toMatchObject({
      eligible: true,
      skip: false,
      reason: "tracker_error",
      shouldRefresh: false,
      retryAt: new Date(NOW + 30_000).toISOString(),
    });

    const boundary = await inspectProviderQuota([{ id: "conn" }], {
      provider: "codex",
      resourceKeys: ["model:gpt-5.4"],
      now: NOW + 30_000,
    });
    expect(boundary.get("conn")).toMatchObject({ reason: "tracker_error", shouldRefresh: true, retryAt: null });
  });

  it("keeps a fresh definitive snapshot authoritative after a newer fetch failure", async () => {
    await seedConnection();
    const database = await import("@/lib/db/index.js");
    const { inspectProviderQuota } = await import("@/shared/services/providerQuotaPreflight");
    const observedAt = new Date(NOW).toISOString();
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn",
      provider: "codex",
      sourceId: SOURCE_ID,
      observedAt,
      snapshots: [{
        identity: { connectionId: "conn", provider: "codex", accountKey: "scope:connection", resourceKey: "scope:account", dimensionKey: "requests:weekly" },
        state: "exhausted",
        amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: 0, unit: null },
        timing: { observedAt, staleAt: new Date(NOW + 120_000).toISOString(), resetAt: new Date(NOW + 120_000).toISOString(), cooldownUntil: null },
        provenance: { sourceType: "provider_api", sourceId: SOURCE_ID, reasonCode: null, metadata: {} },
      }],
      fetchState: { connectionId: "conn", provider: "codex", sourceId: SOURCE_ID, outcome: "success", attemptedAt: observedAt },
    }, { now: NOW, allowCanonicalSentinels: true });
    await database.recordQuotaFetchFailure({
      connectionId: "conn",
      provider: "codex",
      sourceId: SOURCE_ID,
      outcome: "timeout",
      attemptedAt: new Date(NOW + 1_000).toISOString(),
      retryAt: new Date(NOW + 30_000).toISOString(),
      reasonCode: "timeout",
    }, { now: NOW + 1_000 });

    const decisions = await inspectProviderQuota([{ id: "conn" }], {
      provider: "codex",
      resourceKeys: ["model:gpt-5.4"],
      now: NOW + 2_000,
    });
    expect(decisions.get("conn")).toMatchObject({ skip: true, reason: "exhausted", shouldRefresh: false });
  });
});
