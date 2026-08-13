// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, finishActiveSession, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  recordTokenSaverEvent, getTokenSaverStats,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  resetUsageHistory,
} from "@/lib/db/index.js";
