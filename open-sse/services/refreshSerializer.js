/**
 * Global OAuth refresh serialization, keyed by rotation group.
 *
 * Port of OmniRoute commits 697946381d + 6d2e695882 (Front 1 of the Codex
 * multi-account refresh_token family-revocation fix, openai/codex#9648).
 *
 * Why this exists: providers that share a single Auth0 client_id — notably
 * OpenAI Codex and the `openai` provider — enforce "single active session per
 * client_id" and mint a single-use refresh_token on every refresh. When two
 * *sibling* accounts under that client refresh at nearly the same time, Auth0
 * treats it as token reuse and revokes the WHOLE refresh_token family, so
 * previously-healthy accounts suddenly fail with
 * `refresh_token_invalidated` / `refresh_token_reused`.
 *
 * The per-connection inflight dedup in
 * src/shared/services/providerCredentials.js does NOT help: the colliding
 * refreshes happen on DIFFERENT connections. This serializer forces the actual
 * network refresh to concurrency=1 across every connection in a rotation
 * group, so two siblings never POST to /oauth/token concurrently.
 *
 * Rotation-group semantics:
 * - Providers mapped to the same group string share one serialized lane. Codex
 *   and the raw `openai` provider use the same Auth0 backend, so they MUST
 *   share a lane.
 * - Different groups run fully concurrently.
 * - Providers with no group entry (Google, GitHub, etc.) are NOT serialized —
 *   their refresh_tokens are permanent and there is no cascade.
 *
 * Settle gap: when a sibling is already queued behind the current refresh, a
 * small gap (default 2000ms, tunable via CODEX_REFRESH_SPACING_MS, "0" opts
 * out) is inserted before releasing the lane, giving Auth0 time to settle the
 * rotation before the next sibling presents its (now superseded) token. A lone
 * refresh — nobody queued — is released immediately, so the reactive request
 * path pays zero added latency.
 */

// ponytail: `groupTail` below is a process-local in-memory Map keyed by
// rotation group. The ceiling is single-process: a multi-process deployment
// (cluster / worker_threads / separate Node processes behind a load balancer)
// would race, because each process owns its own `groupTail` and siblings in
// different processes could POST to /oauth/token concurrently — reintroducing
// the Auth0 family-revocation cascade this module exists to prevent.
// DurinDoor is safe today: custom-server.js is single-process (it never
// imports cluster, worker_threads, or child_process; the CLI's
// DURINDOOR_WORKER_NONCE only verifies spawned-worker identity, it does not
// split serving across processes). Upgrade path if we ever multi-process:
// persist groupTail to a shared store (Redis SETNX + TTL, or a SQLite
// advisory lock keyed by rotation-group).

// Providers mapped to the same string share one serialized lane.
const ROTATION_LOCK_GROUP = {
  codex: "openai-auth0",
  openai: "openai-auth0",
  claude: "anthropic-oauth",
  "gitlab-duo": "gitlab-duo",
  kiro: "kiro",
  "kimi-coding": "kimi-coding",
  qwen: "qwen",
};

// Protective settle gap (ms) between two consecutive sibling refreshes when
// the env var is unset. Conservative by default; bursts are rare and
// correctness (not revoking the family) outweighs the extra wall-clock on a
// queued refresh.
const DEFAULT_REFRESH_SPACING_MS = 2000;

/**
 * Gap (ms) inserted between two consecutive refreshes in the same rotation
 * group. Only paid when a sibling is already queued behind the current
 * refresh — a lone refresh is released immediately. Tunable via
 * CODEX_REFRESH_SPACING_MS; set it to "0" to opt out entirely.
 */
export function getRefreshSpacingMs() {
  const rawEnv = process.env.CODEX_REFRESH_SPACING_MS;
  if (rawEnv === undefined || rawEnv === "") return DEFAULT_REFRESH_SPACING_MS;
  const raw = Number(rawEnv);
  // Explicit "0" opts out; anything unparseable falls back to the safe default.
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REFRESH_SPACING_MS;
}

// Tail promise per group — each new refresh chains after the previous one.
const groupTail = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns the serialization group for a provider, or null when it is not a rotating provider. */
export function rotationGroupFor(provider) {
  return ROTATION_LOCK_GROUP[provider] ?? null;
}

/**
 * Run `fn` (the actual network refresh) serialized against every other refresh
 * in the same rotation group. Different groups run concurrently; non-rotating
 * providers run immediately with no locking. When another refresh is already
 * queued behind us, the lane is held for a settle gap (getRefreshSpacingMs,
 * default 2000ms, CODEX_REFRESH_SPACING_MS='0' opts out) before release; a
 * lone refresh releases immediately.
 */
export async function serializeRefresh(provider, fn) {
  const group = rotationGroupFor(provider);
  if (!group) return fn();

  const prevTail = groupTail.get(group) ?? Promise.resolve();
  let releaseMine;
  const mine = new Promise((resolve) => {
    releaseMine = resolve;
  });
  const myTail = prevTail.then(() => mine);
  groupTail.set(group, myTail);

  // Wait for our turn. Ignore a predecessor's rejection — its `finally` still
  // releases the lane, so the queue keeps flowing even after a failed refresh.
  await prevTail.catch(() => {});

  try {
    return await fn();
  } finally {
    // Only pay the settle gap when a sibling is already queued behind us — a
    // lone refresh has nobody to collide with, so it must be released
    // immediately (zero added latency on the reactive request path).
    const hasSuccessor = groupTail.get(group) !== myTail;
    if (hasSuccessor) {
      const spacing = getRefreshSpacingMs();
      if (spacing > 0) await delay(spacing);
    }
    releaseMine();
    // Garbage-collect the lane when nobody chained after us.
    if (groupTail.get(group) === myTail) groupTail.delete(group);
  }
}
