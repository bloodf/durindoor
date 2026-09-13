// Token savers: Headroom proxy, PXPIPE, the Token Saver aggregate stream and
// the Compression Studio preview.
import { reply, sse, badRequest } from "../../http.js";
import { ENGINE_CATALOG, ENGINE_IDS, isEngineAvailable } from "open-sse/services/compression/engineCatalog.js";
import { headroomStats, pxpipeLogs, pxpipeStats, tokenSaverStats } from "../../fixtures/tools/savers.js";

const HEADROOM = "tools.headroom";
const PXPIPE = "tools.pxpipe";
const CONFIG_SETTINGS = "config.settings"; // owned by the config domain; read-only here
const HEADROOM_URL = "http://localhost:8787";
const PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "90d", "180d", "365d", "all"]);

const settings = (store) => store.get(CONFIG_SETTINGS) || {};

function registerHeadroom(router, store) {
  store.define(HEADROOM, () => ({ installed: true, running: true, managedPid: 51877, startedAt: Date.now() - 3 * 3_600_000, extras: { code: true, ml: false } }));

  router.get("/api/headroom/status", () => {
    const state = store.get(HEADROOM);
    return {
      installed: state.installed,
      running: state.running,
      version: "0.9.2",
      python: "3.12.4",
      localUrl: true,
      canStart: true,
      source: "managed",
      url: settings(store).headroomUrl || HEADROOM_URL,
      managedPid: state.running ? state.managedPid : null,
      circuit: { state: "closed", failures: 0, openedAt: null, lastFailureAt: null },
    };
  });

  router.get("/api/headroom/stats", ({ searchParams }) => headroomStats(Math.min(Number(searchParams?.get("limit")) || 100, 500)));

  router.get("/api/headroom/extras", () => ({
    available: ["code", "ml"],
    installed: true,
    version: "0.9.2",
    extras: store.get(HEADROOM).extras,
    source: "managed",
    externalInstall: null,
  }));

  router.post("/api/headroom/extras", ({ body }) => {
    const requested = Array.isArray(body?.extras) ? body.extras.filter((extra) => extra === "code" || extra === "ml") : [];
    const next = store.update(HEADROOM, (state) => ({ ...state, extras: { ...state.extras, ...Object.fromEntries(requested.map((extra) => [extra, true])) } }));
    return { success: true, installed: requested, extras: next.extras };
  });

  router.post("/api/headroom/start", () => {
    const pid = 50000 + Math.floor(Math.random() * 9000);
    store.update(HEADROOM, (state) => ({ ...state, running: true, managedPid: pid, startedAt: Date.now() }));
    return { success: true, pid, port: 8787, url: HEADROOM_URL, alreadyRunning: false };
  });

  router.post("/api/headroom/stop", () => {
    const state = store.get(HEADROOM);
    if (!state.running) return reply({ stopped: false, reason: "not running" }, { status: 409 });
    store.update(HEADROOM, (current) => ({ ...current, running: false, managedPid: null }));
    return { stopped: true, pid: state.managedPid };
  });

  router.any("/api/headroom/proxy/*path", () =>
    reply(
      "<!doctype html><title>Headroom</title><body style=\"font-family:system-ui;padding:2rem\"><h1>Headroom proxy</h1><p>Running on 127.0.0.1:8787 &middot; managed by DurinDoor.</p></body>",
      { contentType: "text/html" },
    ),
  );
}

function pxpipeStatus(store) {
  const state = store.get(PXPIPE);
  const current = settings(store);
  return {
    installed: true,
    installMethod: "dependency",
    dependencyMissing: false,
    version: "1.4.0",
    path: "/Applications/DurinDoor.app/Contents/Resources/app/node_modules/pxpipe",
    reason: null,
    code: null,
    running: state.running,
    loadedAt: state.running ? new Date(state.loadedAt).toISOString() : null,
    uptimeMs: state.running ? Date.now() - state.loadedAt : 0,
    mode: "library",
    enabled: current.pxpipeEnabled ?? true,
    minChars: current.pxpipeMinChars ?? 25000,
    timeoutMs: current.pxpipeTimeoutMs ?? 15000,
  };
}

function pxpipeHealth(store) {
  const running = store.get(PXPIPE).running;
  const checks = [
    { id: "installed", label: "PXPIPE installed", ok: true, detail: "v1.4.0" },
    { id: "module", label: "Transform module loads", ok: running, detail: running ? "v1.4.0" : "module not loaded" },
    ...(running ? [{ id: "transform", label: "Test request transforms", ok: true, detail: "184ms (applied)" }] : []),
  ];
  return { healthy: running, checks, error: running ? null : "Cannot load module: service stopped" };
}

function registerPxpipe(router, store) {
  store.define(PXPIPE, () => ({ running: true, loadedAt: Date.now() - 5_400_000 }));

  router.get("/api/pxpipe/status", () => pxpipeStatus(store));
  router.get("/api/pxpipe/stats", () => pxpipeStats());
  router.get("/api/pxpipe/logs", ({ searchParams }) => ({ events: pxpipeLogs(Math.min(Number(searchParams?.get("limit")) || 100, 500)) }));
  router.get("/api/pxpipe/health", () => pxpipeHealth(store));
  router.post("/api/pxpipe/health", () => pxpipeHealth(store));

  const setRunning = (running) => () => {
    store.update(PXPIPE, (state) => ({ ...state, running, loadedAt: running ? Date.now() : state.loadedAt }));
    return pxpipeStatus(store);
  };
  router.post("/api/pxpipe/start", setRunning(true));
  router.post("/api/pxpipe/restart", setRunning(true));
  router.post("/api/pxpipe/stop", setRunning(false));
  router.post("/api/pxpipe/:endpoint", ({ params }) => reply({ error: `Unknown PXPIPE action: ${params.endpoint}` }, { status: 404 }));
}

function registerTokenSaver(router) {
  router.get("/api/token-saver/stream", ({ searchParams }) => {
    const period = searchParams?.get("period") || "7d";
    if (!PERIODS.has(period)) return badRequest("Invalid period");
    return sse({ events: [tokenSaverStats(period)], intervalMs: 25000 });
  });
  router.get("/api/token-saver/stats", ({ searchParams }) => tokenSaverStats(searchParams?.get("period") || "7d"));
}

// Compression preview ---------------------------------------------------------

const FILLER_RE = /\b(?:the|a|an|just|really|basically|actually|simply|very|please|kindly|that is|in order to)\b\s*/gi;

const TEXT_TRANSFORMS = {
  // Drops repeated lines across the whole conversation.
  "session-dedup": () => {
    const seen = new Set();
    return (text) =>
      text
        .split("\n")
        .filter((line) => {
          const key = line.trim();
          if (key.length < 12) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .join("\n");
  },
  // Compacts whitespace and pretty-printed JSON blocks.
  headroom: () => (text) => {
    const trimmed = text.trim();
    if (/^[[{]/.test(trimmed)) {
      try { return JSON.stringify(JSON.parse(trimmed)); } catch { /* not JSON, fall through */ }
    }
    return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\s+/gm, "");
  },
  // Terse rewrite: removes filler words and articles.
  caveman: () => (text) => text.replace(FILLER_RE, "").replace(/[ \t]{2,}/g, " "),
};

function transformContent(content, transform) {
  if (typeof content === "string") return transform(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) => (part?.type === "text" && typeof part.text === "string" ? { ...part, text: transform(part.text) } : part));
}

function previewEngine(id, payload) {
  const transform = TEXT_TRANSFORMS[id]?.();
  if (!transform) return { status: "unchanged", compressed: false, savingsPercent: 0, fallbackReasons: [], skippedReasons: [], fallbackReason: null, raw: payload };
  const body = {
    ...payload,
    ...(Array.isArray(payload.messages) ? { messages: payload.messages.map((message) => ({ ...message, content: transformContent(message.content, transform) })) } : {}),
    ...(typeof payload.system === "string" ? { system: transform(payload.system) } : {}),
  };
  const before = JSON.stringify(payload).length;
  const after = JSON.stringify(body).length;
  const savingsPercent = before > 0 ? Math.max(0, Math.round(((before - after) / before) * 10000) / 100) : 0;
  const compressed = after < before;
  return { status: compressed ? "compressed" : "unchanged", compressed, savingsPercent, fallbackReasons: [], skippedReasons: [], fallbackReason: null, raw: body };
}

function registerCompression(router) {
  router.post("/api/compression/preview", ({ body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, { status: 400 });
    }
    const { engine, ...payload } = body;
    if (engine !== undefined && engine !== "" && (!ENGINE_CATALOG[engine] || !isEngineAvailable(engine))) {
      return reply({ error: { message: `Unknown or unavailable engine: ${engine}`, type: "invalid_request_error" } }, { status: 400 });
    }
    const engineIds = engine ? [engine] : ENGINE_IDS;
    const results = Object.fromEntries(engineIds.map((id) => [id, isEngineAvailable(id) ? previewEngine(id, payload) : { status: "unavailable" }]));
    return { engines: engineIds, results };
  });
}

export default function registerSavers(router, { store }) {
  registerHeadroom(router, store);
  registerPxpipe(router, store);
  registerTokenSaver(router);
  registerCompression(router);
}
