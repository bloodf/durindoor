// UI QA seed/reset for the Durin DS migration. Sole writer of fixture records
// into the disposable QA data directory.
//
// H0a runtime contract (must hold before this module runs):
//   1. {dataDir}/.durindoor-ui-qa-manifest.json is present, realpath-resolved
//      against process.env.DATA_DIR, and parsed with the exact fields:
//        kind="durindoor-ui-qa", version=1, runId, workerId, createdAt, dataDir
//   2. The owning runtime process has fully closed the SQLite adapter and
//      released the timeline sidecar before this module touches the file.
//   3. No host-side dataDir writes — every read/write below is inside the
//      container's tmpfs DATA_DIR.
//
// Safety invariant: this module NEVER deletes rows by name/prefix guess. Every
// row it creates is recorded, by exact primary key, in a seed-state file next
// to the manifest. resetQa (and the self-heal at the top of seedQa) deletes
// only those exact ids, never a LIKE scan over shared tables. OpenCode Go uses
// a local usage aggregate, so its seed includes one real local row instead of
// an OAuth credential that could refresh or request external quota data.
//
// Scenarios are explicit names ("baseline" | "empty" | "providers" | "key" |
// "combo" | "timeline" | "media" | "fail" | "stream"); anything else is a hard
// error so route specs cannot silently consume the wrong fixture.
//
// CLI form (used by H0a in the app container before boot, after DB close):
//   node tests/e2e/seeds.mjs --data-dir <abs> --scenario <name> [--reset]
//                           [--expect-manifest]
//
// CLI writes one JSON line to stdout, exits 0 on success or throws on any
// invariant failure. Programmatic seedQa/resetQa return the same shape.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { register } from "node:module";

// Register the repository's @/* + open-sse/* alias loader BEFORE any dynamic
// import of source code. Same approach as scripts/auto-configure.mjs, so the
// seeds CLI runs as plain Node (`node tests/e2e/seeds.mjs ...`) without
// bundling. The container image must copy scripts/alias-loader.mjs alongside
// tests/e2e/seeds.mjs.
register(new URL("../../scripts/alias-loader.mjs", import.meta.url));

export const QA_MANIFEST_FILENAME = ".durindoor-ui-qa-manifest.json";
export const QA_SEED_STATE_FILENAME = ".durindoor-ui-qa-seed-state.json";
export const CLI_RESULT_PREFIX = "DURIN_UI_QA_RESULT ";
export const SCENARIO_NAMES = Object.freeze([
  "baseline",
  "empty",
  "providers",
  "key",
  "combo",
  "timeline",
  "media",
  "fail",
  "stream",
]);

const MARKER_KIND = "durindoor-ui-qa";
const MARKER_VERSION = 1;

const URL_REGISTRY = Object.freeze({
  providers: "/dashboard/providers",
  combos: "/dashboard/combos",
  timeline: "/dashboard/timeline",
  media: "/dashboard/media-providers",
});

// Source imports remain deferred until after assertOwnedDataDir. A malformed
// caller must fail at the filesystem boundary before Node loads DB modules or
// executes their DATA_DIR initialization side effects.
let dbLoaded = null;
let getAdapter;
let createProviderNode;
let createProviderConnection;
let createApiKey;
let getApiKeyById;
let createCombo;
let getSettings;
let updateSettings;
let setApiKeyProviderConnectionIds;
let startTimelineTrace;
let recordTimeline;
let finishTimelineTrace;
let flushTimeline;
let getTimelineTrace;
let getProxyTimelineAdapter;

async function loadDbApis() {
  if (dbLoaded) return;
  const [driver, nodes, connections, apiKeys, combos, settings, keyScopes, timeline, timelineDb] = await Promise.all([
    import("../../src/lib/db/driver.js"),
    import("../../src/lib/db/repos/nodesRepo.js"),
    import("../../src/lib/db/repos/connectionsRepo.js"),
    import("../../src/lib/db/repos/apiKeysRepo.js"),
    import("../../src/lib/db/repos/combosRepo.js"),
    import("../../src/lib/db/repos/settingsRepo.js"),
    import("../../src/lib/db/repos/apiKeyProviderConnectionsRepo.js"),
    import("../../src/lib/db/repos/proxyTimelineRepo.js"),
    import("../../src/lib/db/proxyTimelineDb.js"),
  ]);
  ({ getAdapter } = driver);
  ({ createProviderNode } = nodes);
  ({ createProviderConnection } = connections);
  ({ createApiKey, getApiKeyById } = apiKeys);
  ({ createCombo } = combos);
  ({ getSettings, updateSettings } = settings);
  ({ setApiKeyProviderConnectionIds } = keyScopes);
  ({ startTrace: startTimelineTrace, record: recordTimeline, finishTrace: finishTimelineTrace,
    flushProxyTimelineForTests: flushTimeline, getTrace: getTimelineTrace } = timeline);
  ({ getProxyTimelineAdapter } = timelineDb);
  dbLoaded = true;
}

function insertFixtureConnection(db, conn) {
  const { id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt } = conn;
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, provider, authType, name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, data, createdAt, updatedAt]
  );
  return conn;
}

async function createFixtureProviderConnection({ provider, authType, name, email = null, priority = null, providerSpecificData = {}, isActive = true }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  return insertFixtureConnection(db, {
    id: `qa-conn-${randomUUID()}`,
    provider,
    authType,
    name,
    email,
    priority,
    isActive,
    data: JSON.stringify({ providerSpecificData: providerSpecificData || {} }),
    createdAt: now,
    updatedAt: now,
  });
}
function readEnvDataDir() {
  const raw = process.env.DATA_DIR;
  if (!raw || !raw.trim()) {
    throw new Error("QA seed: process.env.DATA_DIR is empty; runtime must configure it before seedQa runs");
  }
  return raw;
}

function realpathOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function manifestPathFor(dataDir) {
  return path.join(dataDir, QA_MANIFEST_FILENAME);
}

function seedStatePathFor(dataDir) {
  return path.join(dataDir, QA_SEED_STATE_FILENAME);
}

function loadManifest(dataDir) {
  const candidate = manifestPathFor(dataDir);
  if (!fs.existsSync(candidate)) {
    throw new Error(`QA manifest not found: ${candidate}; runtime must write it before seedQa/resetQa`);
  }
  let raw;
  try { raw = fs.readFileSync(candidate, "utf8"); }
  catch (err) { throw new Error(`QA manifest unreadable: ${candidate} (${err.code || err.message})`); }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { throw new Error(`QA manifest is not valid JSON: ${candidate} (${err.message})`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`QA manifest shape invalid: ${candidate}`);
  }
  if (parsed.kind !== MARKER_KIND) throw new Error(`QA manifest kind mismatch: expected "${MARKER_KIND}", got "${parsed.kind}"`);
  if (parsed.version !== MARKER_VERSION) throw new Error(`QA manifest version mismatch: expected ${MARKER_VERSION}, got ${parsed.version}`);
  for (const field of ["runId", "workerId", "createdAt", "dataDir"]) {
    if (!parsed[field] || typeof parsed[field] !== "string") {
      throw new Error(`QA manifest missing required field: ${field}`);
    }
  }
  const manifestRealDir = realpathOrSelf(path.resolve(parsed.dataDir));
  const runtimeRealDir = realpathOrSelf(path.resolve(dataDir));
  if (manifestRealDir !== runtimeRealDir) {
    throw new Error(`QA manifest dataDir mismatch: manifest=${manifestRealDir} runtime=${runtimeRealDir}`);
  }
  return { ...parsed, resolvedDataDir: runtimeRealDir };
}

/** Throw unless `dataDir` is a manifest-owned QA directory; returns the manifest. */
function assertOwnedDataDir(dataDir) {
  if (typeof dataDir !== "string" || !dataDir.trim()) {
    throw new Error("QA seed: dataDir must be a non-empty string");
  }
  const resolved = path.resolve(dataDir);
  if (!fs.existsSync(manifestPathFor(resolved))) {
    throw new Error(
      `QA seed refuses non-manifest path: ${resolved} lacks ${QA_MANIFEST_FILENAME}; refusing to write production-like state`,
    );
  }
  return loadManifest(resolved);
}

function readSeedState(dataDir) {
  const p = seedStatePathFor(dataDir);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (error) { throw new Error(`QA seed state unreadable: ${p} (${error.code || error.message})`); }
}

function writeSeedState(dataDir, state) {
  const p = seedStatePathFor(dataDir);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

function clearSeedState(dataDir) {
  const p = seedStatePathFor(dataDir);
  try { fs.unlinkSync(p); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

/** Close seed-owned SQLite handles and proxy-timeline timer. Callers must
 * reacquire adapters after seedQa/resetQa returns. */
async function withClosedAdapter(work) {
  async function close(state) {
    if (!state?.instance) return;
    await state.instance.close?.();
    state.instance = null;
    state.initPromise = null;
    state.file = null;
  }
  async function closeSeedResources() {
    await close(globalThis._dbAdapter);
    await close(globalThis._proxyTimelineAdapter);
    if (globalThis._proxyTimelinePruneTimer) {
      clearInterval(globalThis._proxyTimelinePruneTimer);
      delete globalThis._proxyTimelinePruneTimer;
    }
  }
  await closeSeedResources();
  try {
    return await work();
  } finally {
    await closeSeedResources();
  }
}

async function ensureSchemaReady(dataDir) {
  process.env.DATA_DIR = dataDir;
  await getAdapter();
  await getProxyTimelineAdapter();
}

/** Seed local quota data without OAuth refresh, upstream egress, or untracked daily aggregates. */
async function seedLocalUsage(connection) {
  const usageEventId = `qa-usage-${randomUUID()}`;
  const db = await getAdapter();
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, connectionId, endpoint, promptTokens, completionTokens, cost, status, tokens, usageEventId)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [new Date().toISOString(), connection.provider, "ox-alpha-free", connection.id,
      "/v1/chat/completions", 144, 89, 0, "ok",
      JSON.stringify({ prompt_tokens: 144, completion_tokens: 89 }), usageEventId],
  );
  const row = db.get(
    "SELECT id, provider, model, connectionId FROM usageHistory WHERE usageEventId = ?", [usageEventId],
  );
  if (!row) throw new Error(`QA seed: local usage vanished after insert: ${usageEventId}`);
  return row;
}

/** Delete only the exact ids a prior seed run created; no LIKE/prefix scans. */
async function deleteExactIds(ids) {
  const db = await getAdapter();
  let removed = 0;
  db.transaction(() => {
    if (ids.usageHistoryIds?.length) {
      const placeholders = ids.usageHistoryIds.map(() => "?").join(",");
      removed += db.run(`DELETE FROM usageHistory WHERE id IN (${placeholders})`, ids.usageHistoryIds).changes;
    }
    if (ids.apiKeyIds?.length) {
      const placeholders = ids.apiKeyIds.map(() => "?").join(",");
      db.run(`DELETE FROM apiKeyProviderConnections WHERE apiKeyId IN (${placeholders})`, ids.apiKeyIds);
      removed += db.run(`DELETE FROM apiKeys WHERE id IN (${placeholders})`, ids.apiKeyIds).changes;
    }
    if (ids.comboIds?.length) {
      const placeholders = ids.comboIds.map(() => "?").join(",");
      removed += db.run(`DELETE FROM combos WHERE id IN (${placeholders})`, ids.comboIds).changes;
    }
    if (ids.providerNodeIds?.length) {
      const placeholders = ids.providerNodeIds.map(() => "?").join(",");
      removed += db.run(`DELETE FROM providerNodes WHERE id IN (${placeholders})`, ids.providerNodeIds).changes;
    }
    if (ids.providerConnectionIds?.length) {
      const placeholders = ids.providerConnectionIds.map(() => "?").join(",");
      removed += db.run(`DELETE FROM providerConnections WHERE id IN (${placeholders})`, ids.providerConnectionIds).changes;
    }
  });
  if (ids.traceIds?.length) {
    const tl = await getProxyTimelineAdapter();
    tl.transaction(() => {
      for (const traceId of ids.traceIds) {
        tl.run(`DELETE FROM events WHERE trace_id = ?`, [traceId]);
        removed += tl.run(`DELETE FROM traces WHERE id = ?`, [traceId]).changes;
      }
    });
  }
  return removed;
}

async function restorePriorSettings(priorSettings) {
  if (!priorSettings) return;
  const current = await getSettings();
  const patch = {};
  for (const [key, value] of Object.entries(priorSettings)) {
    if (current[key] !== value) patch[key] = value;
  }
  if (Object.keys(patch).length) await updateSettings(patch);
}

function connectScenario(scenario) {
  if (!SCENARIO_NAMES.includes(scenario)) {
    throw new Error(`QA seed: unknown scenario "${scenario}"; expected one of ${SCENARIO_NAMES.join(", ")}`);
  }
}

function publicConnectionRecord(conn) {
  // Never include accessToken/refreshToken/apiKey/idToken — plaintext or
  // encrypted, downstream fixtures must never echo them.
  return {
    id: conn.id,
    provider: conn.provider,
    authType: conn.authType,
    name: conn.name,
    email: conn.email || null,
    isActive: conn.isActive !== false,
    priority: conn.priority ?? null,
  };
}

function publicApiKeyRecord(key) {
  return {
    id: key.id,
    name: key.name,
    isActive: key.isActive !== false,
    allowedCombos: Array.isArray(key.allowedCombos) ? [...key.allowedCombos] : [],
  };
}

function publicComboRecord(combo) {
  return {
    id: combo.id,
    name: combo.name,
    kind: combo.kind || null,
    models: Array.isArray(combo.models) ? [...combo.models] : [],
    allowedConnectionIds: Array.isArray(combo.allowedConnectionIds) ? [...combo.allowedConnectionIds] : [],
    invariant: combo.invariant || null,
  };
}

function publicTraceRecord(trace) {
  return {
    id: trace.id,
    status: trace.status,
    provider: trace.provider,
    model: trace.model,
    connection_id: trace.connection_id || null,
    api_key_id: trace.api_key_id || null,
    started_at: trace.started_at,
    ended_at: trace.ended_at || null,
    total_ms: trace.total_ms ?? null,
  };
}

async function seedProviders({ openaiCompatibleNodeId = null, baseUrl = null } = {}) {
  const primary = await createFixtureProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "QA OpenAI Main",
    priority: 1,
    isActive: true,
    providerSpecificData: { baseUrl: "http://fake-upstream:4100/v1" },
  });
  const localUsage = await createFixtureProviderConnection({
    provider: "opencode-go",
    authType: "apikey",
    name: "QA OpenCode Go Local Usage",
    priority: 2,
    isActive: true,
  });
  const chatConnection = openaiCompatibleNodeId ? await createProviderConnection({
    provider: openaiCompatibleNodeId,
    authType: "apikey",
    name: "QA OpenAI Compatible Chat",
    apiKey: "qa-fixture-key",
    priority: 1,
    isActive: true,
    providerSpecificData: { baseUrl, apiType: "chat" },
  }, { createOnly: true }) : null;
  return { primary, localUsage, chatConnection };
}

async function seedApiKey({ name, allowedCombos = [], dailyLimitTokens = null }) {
  const machineId = `qa${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return createApiKey(name, machineId, allowedCombos, dailyLimitTokens, null);
}

async function seedCombo({ name, kind = null, models, weights, invariant, allowedConnectionIds }) {
  const members = models.map((id, index) => ({ id, weight: Array.isArray(weights) ? weights[index] : 1 }));
  return createCombo({ name, kind, models, members, invariant, allowedConnectionIds });
}

async function seedTimeline({ provider, model, connectionId, apiKeyId, status, totalMs, chunkCount }) {
  const traceId = `qa-trace-${randomUUID()}`;
  startTimelineTrace(traceId, {
    provider, model, connection_id: connectionId, api_key_id: apiKeyId,
    endpoint: "/v1/chat/completions", client_format: "openai", provider_format: "openai",
  });
  for (let i = 0; i < (chunkCount ?? 3); i += 1) {
    recordTimeline(traceId, { type: "sse_chunk", direction: "in", t_ms: i * 12, summary: `delta ${i + 1}`, payload: { delta: `qa chunk ${i + 1}` } });
  }
  finishTimelineTrace(traceId, { status, total_ms: totalMs ?? 240, ttft_ms: 32, fallback_count: 0 });
  await flushTimeline();
  const trace = await getTimelineTrace(traceId);
  if (!trace) throw new Error(`QA seed: timeline trace vanished after flush: ${traceId}`);
  return trace;
}

function buildRecordDescriptor({ scenario, connections, chatConnection, key, combos, traces, providerNodes, manifest, usageHistory }) {
  const mediaProviders = providerNodes.map((node) => ({ id: node.id, type: node.type, name: node.name }));
  const localUsage = usageHistory[0] || null;
  const provider = chatConnection?.provider || null;
  const model = provider ? "gpt-qa-fixture" : null;
  return {
    scenario,
    dataDir: manifest.resolvedDataDir,
    manifest: { runId: manifest.runId, workerId: manifest.workerId, createdAt: manifest.createdAt },
    chatConnection: chatConnection ? publicConnectionRecord(chatConnection) : null,
    provider,
    model,
    urls: {
      ...URL_REGISTRY,
      provider: connections[0] ? `/dashboard/providers/${connections[0].provider}` : null,
      apiKeys: "/dashboard/endpoint",
      combo: combos[0] ? `/dashboard/media-providers/combo/${combos[0].id}` : null,
      trace: traces[0] ? `/dashboard/timeline/${traces[0].id}` : null,
      mediaProvider: providerNodes.find((node) => node.type === "custom-embedding") ? `/dashboard/media-providers/embedding/${providerNodes.find((node) => node.type === "custom-embedding").id}` : null,
    },
    ids: {
      providerIds: connections.map((c) => c.id),
      primaryProviderId: connections[0]?.id || null,
      providerConnectionId: connections[0]?.id || null,
      chatConnectionId: chatConnection?.id || null,
      apiKeyId: key?.id || null,
      comboIds: combos.map((c) => c.id),
      comboId: combos[0]?.id || null,
      traceIds: traces.map((t) => t.id),
      traceId: traces[0]?.id || null,
      usageHistoryIds: usageHistory.map((row) => row.id),
      usageHistoryId: localUsage?.id || null,
      mediaProviderNodeIds: providerNodes.filter((node) => node.type === "custom-embedding").map((node) => node.id),
      mediaProviderNodeId: providerNodes.find((node) => node.type === "custom-embedding")?.id || null,
      openaiCompatibleNodeId: providerNodes.find((node) => node.type === "openai-compatible")?.id || null,
      anthropicCompatibleNodeId: providerNodes.find((node) => node.type === "anthropic-compatible")?.id || null,
    },
    records: {
      providers: connections.map(publicConnectionRecord),
      apiKey: key ? publicApiKeyRecord(key) : null,
      apiKeys: key ? [publicApiKeyRecord(key)] : [],
      combos: combos.map(publicComboRecord),
      traces: traces.map(publicTraceRecord),
      mediaProviders,
      usageHistory: localUsage
        ? [{ id: localUsage.id, provider: localUsage.provider, model: localUsage.model, connectionId: localUsage.connectionId }]
        : [],
    },
  };
}

const TIMELINE_SCENARIOS = new Set(["baseline", "timeline", "fail", "stream"]);

/**
 * Build the requested scenario against the owned data directory. Cleans up
 * any exact-id state left by a prior seedQa call in the same directory before
 * creating new rows (self-heal when a caller forgets to resetQa).
 *
 * @param {{dataDir:string, scenario:string}} input
 * @returns {Promise<object>} record descriptor
 */
export async function seedQa(input) {
  if (!input || typeof input !== "object") throw new Error("QA seed: input must be an object");
  const { dataDir, scenario } = input;
  connectScenario(scenario);
  const manifest = assertOwnedDataDir(dataDir);
  // Bind DATA_DIR BEFORE loading any source module. src/lib/dataDir.js
  // snapshots `export const DATA_DIR = getDataDir()` at import time, so an
  // import before this assignment can read a previous env (production
  // /qa run) and bind the master-key/legacy paths there.
  process.env.DATA_DIR = manifest.resolvedDataDir;
  await loadDbApis();

  return withClosedAdapter(async () => {
    await ensureSchemaReady(manifest.resolvedDataDir);

    // Self-heal: remove exactly what a prior seed run created here.
    const priorState = readSeedState(manifest.resolvedDataDir);
    if (priorState?.ids) {
      await deleteExactIds(priorState.ids);
      await restorePriorSettings(priorState.priorSettings);
    }
    clearSeedState(manifest.resolvedDataDir);

    const priorSettings = await getSettings();
    const priorEnableProxyTimeline = priorSettings.enableProxyTimeline === true;
    if (TIMELINE_SCENARIOS.has(scenario) && !priorEnableProxyTimeline) {
      await updateSettings({ enableProxyTimeline: true });
    }

    const connections = [];
    let key = null;
    const combos = [];
    const traces = [];
    const providerNodes = [];

    const usageHistory = [];

    let openaiCompatibleNode = null;
    if (scenario === "baseline" || scenario === "providers") {
      openaiCompatibleNode = await createProviderNode({
        id: `openai-compatible-${randomUUID()}`,
        type: "openai-compatible",
        name: "QA OpenAI Compatible",
        prefix: "qa-openai",
        apiType: "chat",
        baseUrl: "http://fake-upstream:4100",
      });
      providerNodes.push(openaiCompatibleNode);
    }
    if (scenario === "baseline" || scenario === "providers") {
      providerNodes.push(await createProviderNode({
        id: `anthropic-compatible-${randomUUID()}`,
        type: "anthropic-compatible",
        name: "QA Anthropic Compatible",
        prefix: "qa-anthropic",
        apiType: "anthropic",
        baseUrl: "http://fake-upstream:4100/v1",
      }));
    }

    let chatConnection = null;
    if (scenario === "baseline") {
      const seeded = await seedProviders({
        openaiCompatibleNodeId: openaiCompatibleNode?.id || null,
        baseUrl: openaiCompatibleNode?.baseUrl || null,
      });
      connections.push(seeded.primary, seeded.localUsage);
      chatConnection = seeded.chatConnection;
      usageHistory.push(await seedLocalUsage(seeded.localUsage));
    } else if (scenario !== "empty") {
      const seeded = await seedProviders();
      connections.push(seeded.primary, seeded.localUsage);
      usageHistory.push(await seedLocalUsage(seeded.localUsage));
    }


    let comboForKey = null;
    if (scenario === "baseline" || scenario === "combo") {
      comboForKey = await seedCombo({
        name: "QA Weighted Combo",
        models: ["openai/gpt-qa", "openai/gpt-qa-mini"],
        weights: [3, 1],
        invariant: { allowedProviders: ["openai"] },
        allowedConnectionIds: connections.map((c) => c.id),
      });
      combos.push(comboForKey);
    }

    if (scenario === "baseline" || scenario === "key") {
      key = await seedApiKey({
        name: "QA Primary Key",
        dailyLimitTokens: 1_000_000,
        allowedCombos: comboForKey ? [comboForKey.name] : [],
      });
      if (comboForKey) {
        await setApiKeyProviderConnectionIds(key.id, [connections[0].id]);
        key = await getApiKeyById(key.id);
      }
    }

    if (scenario === "baseline" || scenario === "timeline") {
      traces.push(await seedTimeline({
        provider: "openai", model: "gpt-qa-ok", connectionId: connections[0]?.id || null, apiKeyId: key?.id || null,
        status: "ok", totalMs: 220, chunkCount: 3,
      }));
    }
    if (scenario === "fail") {
      traces.push(await seedTimeline({
        provider: "openai", model: "gpt-qa-fail", connectionId: connections[0]?.id || null, apiKeyId: key?.id || null,
        status: "error", totalMs: 80, chunkCount: 1,
      }));
      traces.push(await seedTimeline({
        provider: "opencode-go", model: "ox-alpha-free", connectionId: connections[1]?.id || null, apiKeyId: key?.id || null,
        status: "cancelled", totalMs: 40, chunkCount: 0,
      }));
    }
    if (scenario === "stream") {
      traces.push(await seedTimeline({
        provider: "openai", model: "gpt-qa-stream", connectionId: connections[0]?.id || null, apiKeyId: key?.id || null,
        status: "ok", totalMs: 320, chunkCount: 8,
      }));
    }
    if (scenario === "baseline" || scenario === "media") {
      // [kind]/page.js filters providerNodes by type === "custom-embedding".
      // Seeds the dynamic /dashboard/media-providers/embedding/[id] page.
      providerNodes.push(await createProviderNode({
        id: `custom-embedding-${randomUUID()}`,
        type: "custom-embedding",
        name: "QA Local Embedding Node",
        prefix: "qa-embed",
        apiType: "openai",
        baseUrl: "http://fake-upstream:4100/v1",
      }));
    }

    if (scenario === "media") {
      combos.push(await seedCombo({
        name: "QA Embedding Combo", kind: "embedding", models: ["openai/text-embed-qa"], weights: [1],
        allowedConnectionIds: connections.map((c) => c.id),
      }));
      combos.push(await seedCombo({
        name: "QA TTS Combo", kind: "tts", models: ["openai/tts-qa"], weights: [1],
        allowedConnectionIds: connections.map((c) => c.id),
      }));
    }

    writeSeedState(manifest.resolvedDataDir, {
      scenario,
      createdAt: new Date().toISOString(),
      ids: {
        providerConnectionIds: [...connections.map((c) => c.id), ...(chatConnection ? [chatConnection.id] : [])],
        apiKeyIds: key ? [key.id] : [],
        comboIds: combos.map((c) => c.id),
        traceIds: traces.map((t) => t.id),
        providerNodeIds: providerNodes.map((node) => node.id),
        usageHistoryIds: usageHistory.map((row) => row.id),
      },
      priorSettings: { enableProxyTimeline: priorEnableProxyTimeline },
    });

    return buildRecordDescriptor({ scenario, connections, chatConnection, key, combos, traces, providerNodes, manifest, usageHistory });
  });
}

/**
 * Delete exactly the rows the last seedQa call created in `dataDir` and
 * restore any settings it flipped. No-op (removed: 0) if nothing was seeded.
 * Does not delete the manifest — runtime owns the disposable directory
 * lifecycle. `preserveAuth` is accepted for interface symmetry with the
 * runtime's stop/restart flow; this seed layer never touches non-QA auth
 * rows regardless of its value (exact-id deletes only touch seeded rows).
 *
 * @param {{dataDir:string, preserveAuth?:boolean}} input
 */
export async function resetQa(input) {
  if (!input || typeof input !== "object") throw new Error("QA reset: input must be an object");
  const { dataDir, preserveAuth = true } = input;
  const manifest = assertOwnedDataDir(dataDir);
  process.env.DATA_DIR = manifest.resolvedDataDir;
  await loadDbApis();

  return withClosedAdapter(async () => {
    await ensureSchemaReady(manifest.resolvedDataDir);
    const state = readSeedState(manifest.resolvedDataDir);
    if (!state?.ids) {
      return { dataDir: manifest.resolvedDataDir, reset: true, preservedAuth: preserveAuth, removed: 0 };
    }
    const removed = await deleteExactIds(state.ids);
    await restorePriorSettings(state.priorSettings);
    clearSeedState(manifest.resolvedDataDir);
    return { dataDir: manifest.resolvedDataDir, reset: true, preservedAuth: preserveAuth, removed };
  });
}

/** Throw unless `dataDir` is a manifest-owned QA directory; returns the manifest. */
export function assertOwnedQaDataDir(dataDir) {
  return assertOwnedDataDir(dataDir);
}

export const __testing = Object.freeze({
  readEnvDataDir,
  loadManifest,
  assertOwnedDataDir,
  withClosedAdapter,
  ensureSchemaReady,
  readSeedState,
  writeSeedState,
  deleteExactIds,
  publicConnectionRecord,
  publicApiKeyRecord,
  publicComboRecord,
  publicTraceRecord,
  buildRecordDescriptor,
  URL_REGISTRY,
});

function parseArgs(argv) {
  const out = { dataDir: null, scenario: null, reset: false, expectManifest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--data-dir") out.dataDir = argv[++i];
    else if (arg === "--scenario") out.scenario = argv[++i];
    else if (arg === "--reset") out.reset = true;
    else if (arg === "--expect-manifest") out.expectManifest = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`seeds.mjs --data-dir <abs> --scenario <name> [--reset] [--expect-manifest]\nscenarios: ${SCENARIO_NAMES.join(", ")}\n`);
      process.exit(0);
    } else {
      throw new Error(`seeds.mjs: unknown argument ${arg}`);
    }
  }
  return out;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dataDir = args.dataDir || readEnvDataDir();
  if (args.expectManifest) assertOwnedQaDataDir(dataDir);
  const result = args.reset ? await resetQa({ dataDir }) :
    args.scenario ? await seedQa({ dataDir, scenario: args.scenario }) :
    (() => { throw new Error("seeds.mjs: --scenario is required (or pass --reset)"); })();
  process.stdout.write(`${CLI_RESULT_PREFIX}${JSON.stringify(result)}\n`);
  return result;
}

const isDirectInvocation = (() => {
  try {
    if (!process.argv[1]) return false;
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch { return false; }
})();

if (isDirectInvocation) {
  runCli().catch((err) => {
    process.stderr.write(`seeds.mjs failed: ${err && err.message ? err.message : err}\n`);
    if (err?.stack) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });
}
