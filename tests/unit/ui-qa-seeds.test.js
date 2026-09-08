import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let seedQa;
let resetQa;
let runCli;
let CLI_RESULT_PREFIX;

function writeManifest(dir) {
  fs.writeFileSync(path.join(dir, ".durindoor-ui-qa-manifest.json"), JSON.stringify({
    kind: "durindoor-ui-qa", version: 1, dataDir: fs.realpathSync(dir),
    runId: "qa-test-run", workerId: "qa-test-worker", createdAt: "2026-09-05T00:00:00.000Z",
  }), { mode: 0o600 });
}

async function closeAdapters() {
  for (const state of [globalThis._dbAdapter, globalThis._proxyTimelineAdapter]) {
    if (!state?.instance) continue;
    await state.instance.close();
    state.instance = null;
    state.initPromise = null;
    state.file = null;
  }
  if (globalThis._proxyTimelinePruneTimer) {
    clearInterval(globalThis._proxyTimelinePruneTimer);
    delete globalThis._proxyTimelinePruneTimer;
  }
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ui-qa-seeds-"));
  writeManifest(dataDir);
  process.env.DATA_DIR = dataDir;
  ({ seedQa, resetQa, runCli, CLI_RESULT_PREFIX } = await import("../e2e/seeds.mjs"));
  await resetQa({ dataDir });
  await seedQa({ dataDir, scenario: "baseline" });
}, 30_000);

afterEach(async () => {
  await resetQa({ dataDir });
  await closeAdapters();
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("UI QA seed boundary", () => {
  it("refuses an unowned path before opening database files", async () => {
    const unownedDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ui-qa-unowned-"));
    try {
      await expect(seedQa({ dataDir: unownedDir, scenario: "baseline" })).rejects.toThrow(/QA seed refuses non-manifest path/);
      expect(fs.existsSync(path.join(unownedDir, "db", "data.sqlite"))).toBe(false);
    } finally {
      fs.rmSync(unownedDir, { recursive: true, force: true });
    }
  });

  it("creates persisted provider, key, combo, scope, and trace relationships", async () => {
    const result = await seedQa({ dataDir, scenario: "baseline" });
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const { getUsageHistory } = await import("../../src/lib/db/repos/usageRepo.js");
    const { getProxyTimelineAdapter } = await import("../../src/lib/db/proxyTimelineDb.js");
    const main = await getAdapter();
    const timeline = await getProxyTimelineAdapter();

    expect(result.ids.providerIds).toHaveLength(2);
    expect(result.records.providers[1]).toMatchObject({ provider: "opencode-go", authType: "apikey", name: "QA OpenCode Go Local Usage" });
    expect(result.chatConnection).toMatchObject({ id: result.ids.chatConnectionId, provider: result.ids.openaiCompatibleNodeId, authType: "apikey", name: "QA OpenAI Compatible Chat" });
    expect(result.provider).toBe(result.ids.openaiCompatibleNodeId);
    expect(result.model).toBe("gpt-qa-fixture");
    expect(result.ids.usageHistoryIds).toEqual([result.ids.usageHistoryId]);
    expect(result.records.usageHistory).toEqual([{ id: result.ids.usageHistoryId, provider: "opencode-go", model: "ox-alpha-free", connectionId: result.ids.providerIds[1] }]);
    expect((await getUsageHistory({ provider: "opencode-go", connectionId: result.ids.providerIds[1] })).find((row) => row.model === "ox-alpha-free")).toMatchObject({
      connectionId: result.ids.providerIds[1], promptTokens: 144, completionTokens: 89, cost: 0,
    });
    expect(result.records.apiKey).toMatchObject({ id: result.ids.apiKeyId, allowedCombos: [result.records.combos[0].name] });
    expect(result.records.combos[0]).toMatchObject({ allowedConnectionIds: result.ids.providerIds, invariant: { allowedProviders: ["openai"] } });
    expect(main.get(`SELECT apiKeyId, connectionId FROM apiKeyProviderConnections WHERE apiKeyId=? AND connectionId=?`, [result.ids.apiKeyId, result.ids.primaryProviderId])).toMatchObject({ apiKeyId: result.ids.apiKeyId, connectionId: result.ids.primaryProviderId });
    expect(timeline.get(`SELECT connection_id, api_key_id, status FROM traces WHERE id=?`, [result.ids.traceId])).toMatchObject({ connection_id: result.ids.primaryProviderId, api_key_id: result.ids.apiKeyId, status: "ok" });
    expect(result.urls.provider).toBe(`/dashboard/providers/${result.records.providers[0].provider}`);
    for (const [id, type] of [[result.ids.openaiCompatibleNodeId, "openai-compatible"], [result.ids.anthropicCompatibleNodeId, "anthropic-compatible"], [result.ids.mediaProviderNodeId, "custom-embedding"]]) {
      expect(id.startsWith(`${type}-`)).toBe(true);
      expect(main.get("SELECT id, type FROM providerNodes WHERE id=?", [id])).toEqual({ id, type });
    }
    expect(JSON.stringify(result)).not.toContain("qa-fixture-key");
  });

  it("reset removes exact tracked IDs, preserves sentinels, and requires reacquire", async () => {
    const seeded = await seedQa({ dataDir, scenario: "baseline" });
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const { getProxyTimelineAdapter } = await import("../../src/lib/db/proxyTimelineDb.js");
    const main = await getAdapter();
    const timeline = await getProxyTimelineAdapter();
    main.run(`INSERT INTO providerConnections(id,provider,authType,name,priority,isActive,data,createdAt,updatedAt) VALUES(?,?,?,?,?,1,'{}',?,?)`, ["sentinel-provider", "openai", "apikey", "Operator provider", 99, "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]);
    main.run(`INSERT INTO combos(id,name,models,members,allowedConnectionIds,createdAt,updatedAt) VALUES(?,'Operator combo','[]','[]','[]',?,?)`, ["sentinel-combo", "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]);
    timeline.run(`INSERT INTO traces(id,started_at,status,provider,model,event_count,payload_bytes,redacted,truncated) VALUES(?,?,?,'openai','operator-model',0,0,1,0)`, ["sentinel-trace", "2026-09-05T00:00:00.000Z", "ok"]);
    const foreignUsageEventId = `operator-usage-${randomUUID()}`;
    main.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, endpoint, promptTokens, completionTokens, cost, status, tokens, usageEventId)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [new Date().toISOString(), "opencode-go", "ox-alpha-free", "sentinel-provider",
        "/v1/chat/completions", 8, 5, 0, "ok",
        JSON.stringify({ prompt_tokens: 8, completion_tokens: 5 }), foreignUsageEventId],
    );
    const foreignUsage = main.get("SELECT id FROM usageHistory WHERE usageEventId=?", [foreignUsageEventId]);
    await resetQa({ dataDir });

    const freshMain = await getAdapter();
    const freshTimeline = await getProxyTimelineAdapter();
    expect(freshMain.get(`SELECT id FROM providerConnections WHERE id=?`, ["sentinel-provider"])).toMatchObject({ id: "sentinel-provider" });
    expect(freshMain.get(`SELECT id FROM combos WHERE id=?`, ["sentinel-combo"])).toMatchObject({ id: "sentinel-combo" });
    expect(freshTimeline.get(`SELECT id FROM traces WHERE id=?`, ["sentinel-trace"])).toMatchObject({ id: "sentinel-trace" });
    expect(freshMain.get(`SELECT id FROM providerConnections WHERE id=?`, [seeded.ids.primaryProviderId])).toBeUndefined();
    expect(freshMain.get(`SELECT id FROM combos WHERE id=?`, [seeded.ids.comboIds[0]])).toBeUndefined();
    expect(freshTimeline.get(`SELECT id FROM traces WHERE id=?`, [seeded.ids.traceIds[0]])).toBeUndefined();
    expect(freshMain.get(`SELECT id FROM usageHistory WHERE id=?`, [seeded.ids.usageHistoryId])).toBeUndefined();
    expect(freshMain.get(`SELECT id FROM usageHistory WHERE id=?`, [foreignUsage.id])).toEqual(foreignUsage);
    freshMain.run(`DELETE FROM providerConnections WHERE id=?`, ["sentinel-provider"]);
    freshMain.run(`DELETE FROM combos WHERE id=?`, ["sentinel-combo"]);
    freshTimeline.run(`DELETE FROM traces WHERE id=?`, ["sentinel-trace"]);
    freshMain.run("DELETE FROM usageHistory WHERE id=?", [foreignUsage.id]);
  });

  it("emits one parseable prefixed CLI result amid stdout diagnostics", async () => {
    const writes = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };
    try {
      const result = await runCli(["--data-dir", dataDir, "--scenario", "baseline", "--expect-manifest"]);
      const results = writes.join("").split("\n").filter((line) => line.startsWith(CLI_RESULT_PREFIX));
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0].slice(CLI_RESULT_PREFIX.length))).toEqual(result);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("separates stream and error timeline outcomes", async () => {
    const stream = await seedQa({ dataDir, scenario: "stream" });
    await resetQa({ dataDir });
    const failure = await seedQa({ dataDir, scenario: "fail" });
    expect(failure.records.traces.map((trace) => trace.status).sort()).toEqual(["cancelled", "error"]);
    expect(failure.ids.traceIds).not.toContain(stream.ids.traceIds[0]);
  });
});
