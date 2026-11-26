import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-19721-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const MODEL = "gpt-5.4";
const LOCK = `modelLock_${MODEL}`;
const HOUR = 60 * 60 * 1000;

async function setup() {
  const database = await import("@/lib/db/index.js");
  const connection = await database.createProviderConnection({
    provider: "openai", authType: "apikey", name: "account", apiKey: "sk-test",
  });
  const base = Date.now() - 10_000;
  const fail = (extra) => database.recordProviderConnectionFallbackState(connection.id, {
    model: MODEL, status: 429, reasonCode: "rate_limited", ...extra,
  });
  return { database, id: connection.id, base, fail };
}

describe("OmniRoute #19721 - a late longer upstream reset extends the cooldown", () => {
  it("extends the lock without touching the newer backoff or error state", async () => {
    const { base, fail } = await setup();
    const short = await fail({ cooldownMs: 30_000, backoffLevel: 1, observedAt: base + 200 });

    const late = await fail({ cooldownMs: 5 * HOUR, backoffLevel: 6, observedAt: base + 100, upstreamReset: true });

    expect(late).toMatchObject({ applied: true, extended: true });
    expect(Date.parse(late.connection[LOCK])).toBe(base + 100 + 5 * HOUR);
    expect(late.connection.backoffLevel).toBe(1);
    expect(late.connection.lastErrorAt).toBe(short.connection.lastErrorAt);
    expect(late.connection[`modelStateObserved_${MODEL}`]).toBe(new Date(base + 200).toISOString());
    expect(late.connection[`modelUpstream_${MODEL}`].lockUntil).toBe(late.connection[LOCK]);
  });

  it("never shortens a lock", async () => {
    const { base, fail } = await setup();
    const long = await fail({ cooldownMs: HOUR, observedAt: base + 200 });

    const late = await fail({ cooldownMs: 1_000 * 60, observedAt: base + 100, upstreamReset: true });

    expect(late.applied).toBe(false);
    expect(late.connection[LOCK]).toBe(long.connection[LOCK]);
  });

  it("ignores a late local backoff estimate", async () => {
    const { base, fail } = await setup();
    const short = await fail({ cooldownMs: 30_000, observedAt: base + 200 });

    const late = await fail({ cooldownMs: HOUR, observedAt: base + 100 });

    expect(late.applied).toBe(false);
    expect(late.connection[LOCK]).toBe(short.connection[LOCK]);
  });

  it("does not recreate a lock that a newer success cleared", async () => {
    const { database, id, base, fail } = await setup();
    await fail({ cooldownMs: 30_000, observedAt: base + 100 });
    await database.clearProviderConnectionFallbackState(id, { model: MODEL, observedAt: base + 300 });

    const late = await fail({ cooldownMs: HOUR, observedAt: base + 200, upstreamReset: true });

    expect(late.applied).toBe(false);
    expect(late.connection[LOCK]).toBeNull();
  });

  it("extends through markAccountUnavailable when the older attempt reports a reset", async () => {
    const { database, id } = await setup();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const now = Date.now();
    await markAccountUnavailable(id, 503, "temporarily unavailable", "openai", MODEL, null, { attemptStartedAt: now - 1_000 });
    const short = await database.getProviderConnectionById(id);

    await markAccountUnavailable(id, 429, "rate limited", "openai", MODEL, now + 5 * HOUR, { attemptStartedAt: now - 5_000 });
    const after = await database.getProviderConnectionById(id);

    expect(Date.parse(short[LOCK])).toBeLessThan(now + HOUR);
    expect(Math.abs(Date.parse(after[LOCK]) - (now + 5 * HOUR))).toBeLessThan(2_000);
    expect(after.backoffLevel).toBe(short.backoffLevel);
  });
});
