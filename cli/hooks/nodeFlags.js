const DEFAULT_MAX_OLD_SPACE_MB = 6144;
const MIN_DEFAULT_OLD_SPACE_MB = 512;
const HEAP_FLAG_PATTERN = /(^|\s)--max[-_]old[-_]space[-_]size(?:=|\s|$)/;

/**
 * Use 75% of the lower known host and process memory, with a 512 MB floor
 * bounded by available memory and a 6144 MB ceiling. Unknown memory uses 6144 MB.
 * @param {number} [totalMemoryBytes]
 * @param {number} [constrainedMemoryBytes]
 * @returns {number}
 */
function defaultHeapMb(totalMemoryBytes, constrainedMemoryBytes) {
  const known = [totalMemoryBytes, constrainedMemoryBytes]
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!known.length) return DEFAULT_MAX_OLD_SPACE_MB;
  const memoryMb = Math.min(...known) / (1024 * 1024);
  return Math.max(1, Math.min(DEFAULT_MAX_OLD_SPACE_MB, Math.floor(memoryMb),
    Math.max(MIN_DEFAULT_OLD_SPACE_MB, Math.floor(memoryMb * 0.75))));
}

/**
 * Resolves operator-controlled heap flags without overriding NODE_OPTIONS.
 * Dedicated values must contain decimal digits only; zero leaves heap sizing
 * entirely to Node (upstream #3368).
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [totalMemoryBytes]
 * @param {number} [constrainedMemoryBytes]
 * @returns {string[]}
 */
function resolveHeapFlags(env = process.env, totalMemoryBytes, constrainedMemoryBytes) {
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
  return [`--max-old-space-size=${defaultHeapMb(totalMemoryBytes, constrainedMemoryBytes)}`];
}

/**
 * Builds server child argv with IPv4-first DNS ordering before optional heap
 * flags so unreachable IPv6 results do not block undici (upstream #2699).
 *
 * @param {string} serverPath
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [totalMemoryBytes]
 * @param {number} [constrainedMemoryBytes]
 * @returns {string[]}
 */
function buildNodeArgs(serverPath, env = process.env, totalMemoryBytes, constrainedMemoryBytes) {
  return ["--dns-result-order=ipv4first", ...resolveHeapFlags(env, totalMemoryBytes, constrainedMemoryBytes), serverPath];
}

module.exports = { buildNodeArgs, resolveHeapFlags };
