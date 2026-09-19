import { NextResponse } from "next/server";
import fs from "node:fs";
import { APP_CONFIG } from "@/shared/constants/config";
import { getDataDir } from "@/lib/dataDir";
import { DATA_FILE } from "@/lib/db/paths";
import { getUsageStats, getActiveRequests, getRecentLogs, getUsageHistory } from "@/lib/db/index.js";
import { isString } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/monitoring
 *
 * One call for the Monitoring page and the endpoint-page activity strip:
 * runtime status, a 24h activity summary, and per-provider health over the
 * last 7 days. Every number comes from data already recorded by the usage
 * DB, nothing new is stored for this endpoint. Gated by MANAGEMENT_API_PATHS
 * in src/dashboardGuard.js, same as /api/usage.
 */
export async function GET() {
  const startedAt = Date.now();

  const [runtime, activity, health] = await Promise.all([
    collectRuntime(),
    collectActivity(),
    collectProviderHealth(),
  ]);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    version: APP_CONFIG?.version || "unknown",
    runtime,
    activity,
    health,
  });
}

/** Runtime status: DB file, data dir, and requests currently in flight. */
async function collectRuntime() {
  const out = {
    dataDir: "",
    dbPath: "",
    dbSizeBytes: 0,
    dbSizeLabel: "-",
    activeRequests: 0,
    activeDetail: [],
    pending: 0,
    errorProvider: "",
    processUptimeSec: Math.round(process.uptime()),
    memoryRssMB: 0,
    nodeVersion: process.version,
  };

  try {
    out.processUptimeSec = Math.round(process.uptime());
    out.memoryRssMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  } catch { /* process metrics unavailable */ }

  try {
    out.dataDir = getDataDir();
    out.dbPath = DATA_FILE;
    out.dbSizeBytes = fs.statSync(DATA_FILE).size;
    out.dbSizeLabel = formatBytes(out.dbSizeBytes);
  } catch { /* db file may not exist yet */ }

  try {
    // getActiveRequests() returns { activeRequests, activeSessions,
    // recentRequests, errorProvider, pending }, not a bare array — the
    // in-flight list lives under .activeRequests.
    const active = await getActiveRequests();
    const list = Array.isArray(active?.activeRequests) ? active.activeRequests : [];
    out.activeDetail = list.map((a) => ({
      model: a.model || "",
      provider: a.provider || "",
      account: a.account || "",
      count: a.count || 0,
    }));
    out.activeRequests = out.activeDetail.reduce((s, a) => s + a.count, 0);
    // byModel/byAccount/byKey in the tracker are three indexes over the same
    // in-flight set, not separate counts, so "pending" is the same total.
    out.pending = out.activeRequests;
    out.errorProvider = active?.errorProvider || "";
  } catch { /* no active requests */ }

  return out;
}

/** 24h activity summary from the usage DB. */
async function collectActivity() {
  const out = {
    today: null,
    successRate: null,
    recent: [],
  };

  try {
    const stats = await getUsageStats("24h");
    if (stats) {
      out.today = {
        requests: stats.totalRequests || 0,
        promptTokens: stats.totalPromptTokens || 0,
        completionTokens: stats.totalCompletionTokens || 0,
        cachedTokens: stats.totalCachedTokens || 0,
        cost: stats.totalCost || 0,
        providers: Object.keys(stats.byProvider || {}).length,
        models: Object.keys(stats.byModel || {}).length,
      };
    }
  } catch { /* stats unavailable */ }

  try {
    // getUsageStats' byProvider entries only carry requests/tokens/cost, no
    // error counts, so the success rate is computed from the raw history
    // rows instead, bounded to the last 24h so this stays a small scan.
    const rows = await getUsageHistory({ startDate: new Date(Date.now() - DAY_MS).toISOString() });
    const list = Array.isArray(rows) ? rows : [];
    const errs = list.filter((r) => !isOkStatus(r.status)).length;
    if (list.length > 0) {
      out.successRate = Number((((list.length - errs) / list.length) * 100).toFixed(1));
    }
  } catch { /* history unavailable */ }

  try {
    // getRecentLogs returns pre-formatted strings, not objects:
    //   "dd-mm-yyyy HH:MM:SS | model | PROVIDER | account | prompt | completion | status"
    const logs = await getRecentLogs(20);
    out.recent = (Array.isArray(logs) ? logs : []).slice(0, 20).map(parseLogLine);
  } catch { /* logs unavailable */ }

  return out;
}

/** parseLogLine turns one getRecentLogs() line into an object for the UI. */
function parseLogLine(line) {
  if (!isString(line)) return { raw: String(line ?? "") };
  const parts = line.split("|").map((s) => s.trim());
  if (parts.length < 7) return { raw: line };
  return {
    timestamp: parts[0],
    model: parts[1],
    provider: parts[2],
    account: parts[3],
    promptTokens: parts[4],
    completionTokens: parts[5],
    status: parts[6],
    raw: line,
  };
}

/** Per-provider health over the last 7 days: requests, errors, last used. */
async function collectProviderHealth() {
  const providers = [];

  try {
    const stats = await getUsageStats("7d");
    const byProvider = stats?.byProvider || {};

    // Error counts and last-used timestamps aren't on byProvider; read them
    // from usageHistory directly, bounded to the same 7d window so a 10s
    // dashboard poll never scans the full table.
    const { errors: errMap, lastUsed: lastMap } = await providerActivityIndex();

    for (const [id, data] of Object.entries(byProvider)) {
      const requests = Number(data?.requests ?? 0);
      const errors = errMap[id] || 0;
      providers.push({
        id,
        name: data?.name || id,
        requests,
        errors,
        successRate:
          requests > 0
            ? Number((((requests - errors) / requests) * 100).toFixed(1))
            : null,
        lastUsed: lastMap[id] || "",
        cost: Number(data?.cost || 0),
      });
    }
  } catch { /* stats unavailable */ }

  providers.sort((a, b) => b.requests - a.requests);
  return providers.slice(0, 50);
}

/**
 * Per-provider error count and last-used timestamp from usageHistory,
 * bounded to the last 7 days to match collectProviderHealth()'s window.
 */
async function providerActivityIndex() {
  const errors = {};
  const lastUsed = {};
  try {
    const rows = await getUsageHistory({ startDate: new Date(Date.now() - 7 * DAY_MS).toISOString() });
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r.provider || "";
      if (!isOkStatus(r.status)) errors[id] = (errors[id] || 0) + 1;

      const t = r.timestamp || "";
      if (t && (!lastUsed[id] || String(t) > String(lastUsed[id]))) {
        lastUsed[id] = t;
      }
    }
  } catch { /* table unavailable */ }
  return { errors, lastUsed };
}

/** A request status counts as success when empty, "ok", "success", or "200". */
function isOkStatus(status) {
  const s = String(status ?? "ok").toLowerCase();
  return s === "" || s === "ok" || s === "success" || s === "200";
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
