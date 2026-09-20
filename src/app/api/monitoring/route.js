import { NextResponse } from "next/server";
import fs from "node:fs";
import { APP_CONFIG } from "@/shared/constants/config";
import { getDataDir } from "@/lib/dataDir";
import { DATA_FILE } from "@/lib/db/paths";
import { getActiveRequests, getRecentLogs } from "@/lib/db/index.js";
import { getMonitoringUsage } from "@/lib/db/repos/monitoringUsageRepo.js";
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

  const [runtime, usage, recent] = await Promise.all([
    collectRuntime(),
    getMonitoringUsage({
      activityStart: new Date(startedAt - DAY_MS).toISOString(),
      healthStart: new Date(startedAt - 7 * DAY_MS).toISOString(),
      now: new Date(startedAt).toISOString(),
    }).catch(() => ({ today: null, successRate: null, health: [] })),
    collectRecent(),
  ]);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    version: APP_CONFIG?.version || "unknown",
    runtime,
    activity: { today: usage.today, successRate: usage.successRate, recent },
    health: usage.health,
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

/** Only the twenty log lines rendered by the activity strip are requested. */
async function collectRecent() {
  try {
    const logs = await getRecentLogs(20);
    return logs.map(parseLogLine);
  } catch { return []; }
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


function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
