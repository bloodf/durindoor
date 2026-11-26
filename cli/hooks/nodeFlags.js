const DEFAULT_MAX_OLD_SPACE_MB = 6144;
const MIN_DEFAULT_OLD_SPACE_MB = 512;
const HEAP_FLAG_PATTERN = /(^|\s)--max[-_]old[-_]space[-_]size(?:=|\s|$)/;

/**
 * Default heap cap: 75% of host memory, from 512 MB up to 6144 MB, so a small
 * host is not given a cap above its memory (9router #3863). Without a memory
 * figure the cap is 6144 MB.
 * @param {number} [totalMemoryBytes]
 * @returns {number}
 */
function defaultHeapMb(totalMemoryBytes) {
  if (!totalMemoryBytes) return DEFAULT_MAX_OLD_SPACE_MB;
  const sized = Math.floor((totalMemoryBytes / (1024 * 1024)) * 0.75);
  return Math.min(DEFAULT_MAX_OLD_SPACE_MB, Math.max(MIN_DEFAULT_OLD_SPACE_MB, sized));
}

/**
 * Resolves operator-controlled heap flags without overriding NODE_OPTIONS.
 * Dedicated values must contain decimal digits only; zero leaves heap sizing
 * entirely to Node (upstream #3368).
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [totalMemoryBytes]
 * @returns {string[]}
 */
function resolveHeapFlags(env = process.env, totalMemoryBytes) {
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
  return [`--max-old-space-size=${defaultHeapMb(totalMemoryBytes)}`];
}

/**
 * Builds server child argv with IPv4-first DNS ordering before optional heap
 * flags so unreachable IPv6 results do not block undici (upstream #2699).
 *
 * @param {string} serverPath
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [totalMemoryBytes]
 * @returns {string[]}
 */
function buildNodeArgs(serverPath, env = process.env, totalMemoryBytes) {
  return ["--dns-result-order=ipv4first", ...resolveHeapFlags(env, totalMemoryBytes), serverPath];
}

module.exports = { buildNodeArgs, resolveHeapFlags };
