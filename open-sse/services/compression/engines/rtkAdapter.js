// open-sse/services/compression/engines/rtkAdapter.js
//
// RTK as an explicit compression-stack engine (#1098). Mirrors OmniRoute's
// engineCatalog.ts `rtk` entry (diegosouzapw/OmniRoute@61e07fb7, MIT) but
// reuses this tree's dedicated RTK filters (open-sse/rtk/index.js) instead of
// porting OmniRoute's separate RTK engine.
//
// One pass per request: chatCore runs RTK at its dedicated position (before
// translation for Cursor, after it for every other provider) whenever the RTK
// toggle OR an `rtk` stack step is enabled, then passes `rtkApplied: true` so
// this step is a no-op. The engine only does work when nothing ran RTK yet
// (Test Savers preview, or an adaptive plan that escalated into RTK).
// Error tool results are skipped by compressMessages; failures fail open.

import { compressMessages } from "../../../rtk/index.js";
import { createCompressionStats } from "../stats.js";

export const rtkEngine = {
  id: "rtk",
  name: "RTK",
  description: "Command-output filtering for successful tool results.",
  icon: "terminal",
  targets: ["tool_results"],
  stackable: true,
  stackPriority: 10,
  metadata: {
    id: "rtk",
    name: "RTK",
    description: "Command-output filtering for successful tool results.",
    inputScope: "tool-results",
    targetLatencyMs: 5,
    supportsPreview: true,
    stable: true
  },
  apply(body, options) {
    if (options?.config?.rtkApplied === true) return { body, compressed: false, stats: null };
    const working = structuredClone(body);
    const rtk = compressMessages(working, true);
    if (!rtk?.hits?.length) return { body, compressed: false, stats: null };
    const stats = createCompressionStats(body, working, "rtk", [...new Set(rtk.hits.map((h) => h.filter ?? "rtk"))]);
    return { body: working, compressed: true, stats: { ...stats, rtk } };
  },
  compress(body, config) {
    return this.apply(body, { stepConfig: config });
  },
  getConfigSchema() {
    return [];
  },
  validateConfig() {
    return { valid: true, errors: [] };
  }
};
