// Usage domain: usage analytics, request logs/details, proxy timeline and the
// live server console.
import registerStats from "./usage/stats.js";
import registerLogs from "./usage/logs.js";
import registerTimeline from "./usage/timeline.js";
import registerConsoleLog from "./usage/consoleLog.js";

export default function register(router, context) {
  registerStats(router, context);
  registerLogs(router, context);
  registerTimeline(router, context);
  registerConsoleLog(router, context);
}
