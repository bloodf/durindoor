const DEFAULT_MAX_OLD_SPACE_MB = 6144;
const HEAP_FLAG_PATTERN = /(^|\s)--max[-_]old[-_]space[-_]size(?:=|\s|$)/;

/**
 * Resolves operator-controlled heap flags without overriding NODE_OPTIONS.
 * Dedicated values must contain decimal digits only; zero leaves heap sizing
 * entirely to Node (upstream #3368).
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function resolveHeapFlags(env = process.env) {
  const explicit = String(env.NINEROUTER_MAX_OLD_SPACE_SIZE ?? "").trim();
  if (explicit) {
    if (explicit === "0") return [];
    const megabytes = /^\d+$/.test(explicit) ? Number(explicit) : NaN;
    if (Number.isInteger(megabytes) && megabytes > 0) {
      return [`--max-old-space-size=${megabytes}`];
    }
    console.warn(
      `[durindoor] ignoring NINEROUTER_MAX_OLD_SPACE_SIZE="${explicit}": expected a positive integer (MB) or 0`,
    );
  }

  if (HEAP_FLAG_PATTERN.test(String(env.NODE_OPTIONS ?? ""))) return [];
  return [`--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_MB}`];
}

/**
 * Builds server child argv with IPv4-first DNS ordering before optional heap
 * flags so unreachable IPv6 results do not block undici (upstream #2699).
 *
 * @param {string} serverPath
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function buildNodeArgs(serverPath, env = process.env) {
  return ["--dns-result-order=ipv4first", ...resolveHeapFlags(env), serverPath];
}

module.exports = { buildNodeArgs, resolveHeapFlags };
