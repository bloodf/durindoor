// PostgreSQL capability gate.
//
// Reads the cluster's `server_version_num` and the per-feature GUCs that
// the runtime cares about, and computes the effective enabled-state of
// every entry in `databasePgFeatures`. The result is consumed by:
//   - the boot-time fallback wrapper (`postgresFallback.boot`) to warn
//     on a `databasePgVersion` cap that is higher than the cluster,
//   - the settings UI to render the per-feature effective state,
//   - the cutover pipeline (no caller yet uses this directly; the
//     pipeline is a no-op on PG 16 by virtue of the matrix below).
//
// The matrix is the authoritative enumeration of features the runtime
// can exercise. New entries go in `DEFAULT_FEATURES` below; the unit
// test `postgresCapabilityGate.test.js` asserts every entry against
// the four supported cluster versions.

import { isString, isObject } from "../../shared/utils/typeChecks.js";

/** Parse a `requires: ">=N"` string into a major-version number. */
function parseRequiredMajor(spec) {
  if (!isString(spec)) return 0;
  const m = spec.match(/>=(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Default per-feature map. Targets PG 18 with every eligible feature
 * on by default. The "always on" entries (placeholders, SCRAM, wal_level)
 * are not in this map; the gate treats them as a no-op for older
 * versions because the runtime never relies on their absence.
 */
export const DEFAULT_FEATURES = Object.freeze({
  jsonTable:            { enabled: true,  requires: ">=17" },
  mergeReturning:       { enabled: true,  requires: ">=17" },
  copyOnError:          { enabled: true,  requires: ">=17" },
  sslnegotiationDirect: { enabled: true,  requires: ">=17" },
  incrementalBackup:    { enabled: true,  requires: ">=17" },
  streamingIo:          { enabled: true,  requires: ">=17" },
  vacuumMemoryOpt:      { enabled: true,  requires: ">=17" },
  notNullElimination:   { enabled: true,  requires: ">=17" },
  inBtreeOpt:           { enabled: true,  requires: ">=17" },
  parallelGin:          { enabled: true,  requires: ">=17" },
  aio:                  { enabled: true,  requires: ">=18" },
  skipScan:             { enabled: true,  requires: ">=18" },
  logLockWaits:         { enabled: true,  requires: ">=18" },
  pgUpgradeSwap:        { enabled: true,  requires: ">=18" },
  plannerStatsPreserved:{ enabled: true,  requires: ">=18" },
  uuidv7:               { enabled: false, requires: ">=18" },
  // 19+ (forward; defaults off because the runtime does not use them yet)
  onConflictDoSelect:   { enabled: false, requires: ">=19" },
  forPortionOf:         { enabled: false, requires: ">=19" },
  waitForLsn:           { enabled: false, requires: ">=19" },
  pgPlanAdvice:         { enabled: false, requires: ">=19" },
  parallelAutovacuum:   { enabled: false, requires: ">=19" },
  repack:               { enabled: false, requires: ">=19" },
  onlineChecksumToggle: { enabled: false, requires: ">=19" },
});

/**
 * Compute the effective state of every feature given the cluster's
 * major version and the operator's `databasePgFeatures` map.
 *
 * @param {object} cluster - the cluster info from the PG adapter
 *   capabilities (`serverVersionNum`, `serverVersion`, `ioMethod`,
 *   `walLevel`, `logLockWaits`).
 * @param {number} versionCap - the operator's `databasePgVersion` (16/17/18).
 * @param {object} features - the operator's `databasePgFeatures` map
 *   (defaults to `DEFAULT_FEATURES` if omitted).
 * @returns {{
 *   clusterMajor: number,
 *   versionCap: number,
 *   versionMismatch: boolean,
 *   effective: { [featureId: string]: { enabled: boolean, requires: number, requiresMajor: number, clusterMajor: number } }
 * }}
 */
export function evaluateCapabilities(cluster = {}, versionCap = 18, features) {
  const cfg = features && isObject(features) ? features : DEFAULT_FEATURES;
  const clusterMajor = parseInt(String(cluster.serverVersionNum || 0).slice(0, 2), 10) || 0;
  const cap = Number(versionCap) || 18;
  const effective = {};
  for (const [id, def] of Object.entries(cfg)) {
    const requiresMajor = parseRequiredMajor(def && def.requires);
    const enabled = Boolean(def && def.enabled) && clusterMajor >= requiresMajor && clusterMajor >= cap;
    effective[id] = {
      enabled,
      requires: def && def.requires,
      requiresMajor,
      clusterMajor,
    };
  }
  return {
    clusterMajor,
    versionCap: cap,
    versionMismatch: clusterMajor > 0 && cap > clusterMajor,
    effective,
  };
}

/**
 * Quick check: is a given feature enabled given the cap, the cluster
 * version, and the operator's per-feature map? Returns `false` if the
 * feature id is unknown (defence in depth).
 */
export function isFeatureEnabled(id, cluster, versionCap, features) {
  const out = evaluateCapabilities(cluster, versionCap, features);
  if (!out.effective[id]) return false;
  return out.effective[id].enabled;
}

/**
 * Returns the list of features that the operator EXPLICITLY turned off,
 * i.e. features that are enabled by default in `DEFAULT_FEATURES` but
 * disabled in the operator's `features` map. A feature that is
 * default-off (e.g. `uuidv7`) is not "operator-disabled" — it is
 * "default-off" and the dashboard surfaces it differently.
 */
export function listOperatorDisabled(cluster, versionCap, features) {
  const out = evaluateCapabilities(cluster, versionCap, features);
  return Object.entries(out.effective)
    .filter(([id]) => {
      const def = DEFAULT_FEATURES[id];
      const cur = (features || DEFAULT_FEATURES)[id];
      if (!def || !cur) return false;
      return def.enabled === true && cur.enabled === false;
    })
    .map(([id]) => id);
}
