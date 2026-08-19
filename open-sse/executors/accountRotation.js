/**
 * Shared multi-account rotation mechanics for noauth executors that round-robin
 * across several "accounts" (fingerprints), each with an optional dedicated
 * proxy — currently `MimocodeExecutor` (and `OpencodeExecutor` in upstream).
 *
 * Extracted after both executors independently implemented the same
 * pickAccount/markCooldown/markSuccess skeleton with the same exponential
 * backoff, and independently needed the same fix for the same latent bug (a
 * network exception was treated as account-scoped rotation fodder even for
 * accounts sharing the default egress — see `isNetworkErrorRotatable`).
 */
import { TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";


/**
 * @typedef {{
 *   type: string,
 *   host: string,
 *   port: number,
 *   username?: string,
 *   password?: string,
 *   relayAuth?: string,
 * } | null} AccountProxy
 *
 * @typedef {{
 *   fingerprint: string,
 *   cooldownUntil: number,
 *   consecutiveFails: number,
 *   proxy: AccountProxy,
 * }} RotatableAccount
 */

const COOLDOWN_BASE_MS = TRANSIENT_COOLDOWN_MS;
// ponytail: COOLDOWN_MS.transientMax absent in DurinDoor's errorConfig; reuse the
// pre-port 60s ceiling (matches upstream's intent). Upgrade when errorConfig grows
// the named cap.
const COOLDOWN_MAX_MS = 60_000;

export function isAccountReady(account) {
  return account.cooldownUntil <= Date.now();
}

/**
 * Round-robin pick, skipping accounts not `isReady`; falls back to the next
 * index (even if not ready) so a caller always gets an account rather than
 * hanging when every account is unavailable. Mutates `state.nextAccountIdx`.
 *
 * `isReady` defaults to the plain cooldown check (`isAccountReady`); pass a
 * custom predicate when readiness depends on more than cooldown (e.g.
 * mimocode's JWT-freshness-aware variant).
 *
 * @template {RotatableAccount} T
 * @param {T[]} accounts
 * @param {{ nextAccountIdx: number }} state
 * @param {(account: T) => boolean} [isReady]
 * @returns {T}
 */
export function pickAccount(accounts, state, isReady = isAccountReady) {
  for (let i = 0; i < accounts.length; i++) {
    const idx = (state.nextAccountIdx + i) % accounts.length;
    const acct = accounts[idx];
    if (isReady(acct)) {
      state.nextAccountIdx = (idx + 1) % accounts.length;
      return acct;
    }
  }
  const fallbackIdx = state.nextAccountIdx % accounts.length;
  state.nextAccountIdx = (state.nextAccountIdx + 1) % accounts.length;
  return accounts[fallbackIdx];
}

export function markCooldown(account) {
  account.consecutiveFails += 1;
  const backoff = Math.min(
    COOLDOWN_BASE_MS * 2 ** (account.consecutiveFails - 1),
    COOLDOWN_MAX_MS,
  );
  account.cooldownUntil = Date.now() + backoff + Math.random() * 1000;
}

export function markSuccess(account) {
  account.consecutiveFails = 0;
}

/** Mask an account id for logs (UI calls it a fingerprint). */
export function maskAccountId(fingerprint) {
  if (!fingerprint) return "direct";
  return `${String(fingerprint).slice(0, 8)}…`;
}

/**
 * Whether a network exception (timeout, connection refused/reset) on this
 * account should trigger rotation to the next account, vs propagating.
 *
 * Only true when the account has its own egress (a configured proxy) — that's
 * the only case where the failure is attributable to this account. Proxy-less
 * accounts share the default egress, so rotating would just retry the same
 * outage against every account while poisoning each one's cooldown for a cause
 * that isn't theirs.
 */
export function isNetworkErrorRotatable(account) {
  return account.proxy !== null;
}
