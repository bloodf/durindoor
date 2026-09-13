// /api/settings/database (+ engine, test, cutover, rollback, log, selective).
// The mock cannot see request headers, so the dashboard password prompt is
// accepted as-is.
import { badRequest, reply, wait } from "../../http.js";
import { CONNECTIONS, DEMO_VERSION } from "../../fixtures/world.js";
import { COMBOS } from "./combos.js";
import { readSettings, writeSettings } from "./settings.js";

const DB_STATE = "config.database";
const CLUSTER_MAJOR = 18;
const SCHEMA_VERSION = 42;
const BUNDLE_FORMAT = "durindoor-selective-transfer";

function requiredMajor(requires) {
  return Number(String(requires || "").replace(/[^0-9]/g, "")) || 0;
}

function engineStatus(store) {
  const settings = readSettings(store);
  const state = store.get(DB_STATE);
  const features = settings.databasePgFeatures || {};
  const major = settings.databasePgVersion || CLUSTER_MAJOR;
  const effective = Object.fromEntries(Object.entries(features).map(([id, def]) => [
    id,
    { enabled: def.enabled === true && major >= requiredMajor(def.requires), requires: def.requires },
  ]));
  return {
    activeEngine: settings.databaseEngine === "postgres" ? "postgres" : "sqlite",
    databaseEngine: settings.databaseEngine,
    databaseEngineError: settings.databaseEngineError,
    databaseCutoverAt: settings.databaseCutoverAt,
    databaseCutoverSchemaVersion: settings.databaseCutoverSchemaVersion,
    databasePgVersion: settings.databasePgVersion,
    databasePgFeatures: features,
    effectiveCapabilities: effective,
    versionMismatch: false,
    operatorDisabled: Object.entries(features).filter(([, def]) => def.enabled !== true).map(([id]) => id),
    postgresHost: settings.postgresHost,
    postgresPort: settings.postgresPort,
    postgresDatabase: settings.postgresDatabase,
    postgresUser: settings.postgresUser,
    postgresSslmode: settings.postgresSslmode,
    postgresAuthSource: settings.postgresAuthSource,
    snapshots: state.snapshots,
  };
}

function parsePostgresUrl(raw) {
  try {
    const url = new URL(raw);
    if (!/^postgres(ql)?:$/.test(url.protocol)) return null;
    return { host: url.hostname, port: Number(url.port) || 5432, database: url.pathname.replace(/^\//, "") || "durindoor", user: decodeURIComponent(url.username || "postgres") };
  } catch {
    return null;
  }
}

function providerRows(ids) {
  return CONNECTIONS.filter((connection) => !ids || ids.includes(connection.id))
    .map(({ id, provider, authType, name, priority, isActive }) => ({ id, provider, authType, name, priority, isActive }));
}

function exportBundle(store, selection) {
  const comboIds = selection?.combos;
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    providerConnections: providerRows(selection?.providers || []),
    combos: store.list(COMBOS).filter((combo) => (comboIds || []).includes(combo.id)),
  };
}

function previewBundle(store, bundle) {
  if (bundle?.format !== BUNDLE_FORMAT || !Array.isArray(bundle.providerConnections) || !Array.isArray(bundle.combos)) {
    throw new Error("Invalid selective transfer bundle");
  }
  const combos = store.list(COMBOS);
  return {
    providerConnections: bundle.providerConnections.map((row) => ({
      id: row.id,
      currentName: row.name,
      action: CONNECTIONS.some((connection) => connection.id === row.id) ? "update" : "create",
    })),
    combos: bundle.combos.map((row) => {
      const existing = combos.find((combo) => combo.id === row.id || combo.name === row.name);
      return { id: row.id, currentName: existing?.name || row.name, finalName: row.name, action: existing ? "update" : "create" };
    }),
    secretsIncluded: false,
  };
}

function applyBundle(store, bundle) {
  previewBundle(store, bundle);
  const now = new Date().toISOString();
  bundle.combos.forEach((row) => {
    const existing = store.list(COMBOS).find((combo) => combo.id === row.id || combo.name === row.name);
    if (existing) store.patch(COMBOS, existing.id, { models: row.models || existing.models, updatedAt: now });
    else store.insert(COMBOS, { members: null, invariant: null, capabilities: null, allowedConnectionIds: [], ...row, id: row.id || store.newId("combo"), createdAt: now, updatedAt: now });
  });
  return { providers: bundle.providerConnections.length, combos: bundle.combos.length };
}

function selective(store, body = {}) {
  const { action, selection, bundle, includeSecrets = false, acknowledgeSecretExport = false } = body;
  if (action === "catalog") {
    return {
      providers: CONNECTIONS.map(({ id, name, provider }) => ({ id, name: name || provider })),
      combos: store.list(COMBOS).map(({ id, name }) => ({ id, name })),
    };
  }
  if (action === "preview") {
    return bundle ? previewBundle(store, bundle) : { ...exportBundle(store, selection), secretsIncluded: false };
  }
  if (action === "export") {
    if (includeSecrets && !acknowledgeSecretExport) throw new Error("Exporting credentials requires acknowledgeSecretExport: true");
    return { ...exportBundle(store, selection), secretsIncluded: includeSecrets === true };
  }
  if (action === "apply") return { success: true, imported: applyBundle(store, bundle) };
  throw new Error(`Unknown selective transfer action: ${action || "(missing)"}`);
}

export default function register(router, { store }) {
  store.define(DB_STATE, () => ({ savedUrl: null, snapshots: [] }));

  // Full backup export / import (profile page).
  router.get("/api/settings/database", () => ({
    format: "durindoor-backup",
    version: DEMO_VERSION,
    exportedAt: new Date().toISOString(),
    secretsIncluded: false,
    settings: readSettings(store),
    providerConnections: providerRows(),
    combos: store.list(COMBOS),
  }));
  router.post("/api/settings/database", async ({ body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Invalid backup file");
    await wait(700);
    return { success: true };
  });

  router.get("/api/settings/database/engine", () => engineStatus(store));
  router.post("/api/settings/database/engine", ({ body = {} }) => {
    const allowed = ["databasePgVersion", "databasePgFeatures", "postgresHost", "postgresPort", "postgresDatabase", "postgresUser", "postgresSslmode", "postgresAuthSource"];
    const patch = Object.fromEntries(allowed.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
    return { ok: true, settings: writeSettings(store, patch) };
  });

  router.post("/api/settings/database/test", async ({ body = {} }) => {
    if (typeof body.url !== "string" || !body.url) return reply({ ok: false, error: "url is required" }, { status: 400 });
    await wait(500);
    const parsed = parsePostgresUrl(body.url);
    if (!parsed) return reply({ ok: false, error: "Connection URL must start with postgres:// or postgresql://", latencyMs: 0 }, { status: 400 });
    if (body.persist) {
      store.update(DB_STATE, (state) => ({ ...state, savedUrl: body.url }));
      writeSettings(store, { postgresHost: parsed.host, postgresPort: parsed.port, postgresDatabase: parsed.database, postgresUser: parsed.user });
    }
    return { ok: true, latencyMs: 14, serverVersion: "PostgreSQL 18.1" };
  });

  router.post("/api/settings/database/cutover", async ({ body = {} }) => {
    const url = body.url || store.get(DB_STATE).savedUrl;
    if (!url) return reply({ ok: false, error: "url is required (provide it in the body or save it via /test)" }, { status: 400 });
    await wait(2500);
    const cutoverAt = new Date().toISOString();
    const snapshot = { path: `~/.9router/db/backups/pre-cutover-${cutoverAt.replace(/[:.]/g, "-")}.sqlite`, createdAt: cutoverAt, sizeBytes: 48_213_504 };
    store.update(DB_STATE, (state) => ({ ...state, snapshots: [snapshot, ...state.snapshots] }));
    writeSettings(store, { databaseEngine: "postgres", databaseEngineError: null, databaseCutoverAt: cutoverAt, databaseCutoverSchemaVersion: SCHEMA_VERSION });
    return { ok: true, engine: "postgres", cutoverAt, schemaVersion: SCHEMA_VERSION, tablesCopied: 27, rowsCopied: 184_302, snapshotPath: snapshot.path };
  });

  router.post("/api/settings/database/rollback", async () => {
    const [snapshot] = store.get(DB_STATE).snapshots;
    if (!snapshot) return reply({ ok: false, error: "No cutover snapshot found" }, { status: 500 });
    await wait(1200);
    writeSettings(store, { databaseEngine: "sqlite", databaseCutoverAt: null, databaseCutoverSchemaVersion: null });
    return { ok: true, engine: "sqlite", restoredFrom: snapshot.path };
  });

  router.get("/api/settings/database/log", () => {
    const settings = readSettings(store);
    if (settings.databaseEngine !== "postgres") return { rows: [], engine: "sqlite" };
    return { rows: [{ id: 1, startedAt: settings.databaseCutoverAt, finishedAt: settings.databaseCutoverAt, status: "ok", schemaVersion: SCHEMA_VERSION }], engine: "postgres" };
  });

  router.post("/api/settings/database/selective", async ({ body }) => {
    await wait(300);
    try {
      return selective(store, body || {});
    } catch (error) {
      return badRequest(error.message);
    }
  });
}
