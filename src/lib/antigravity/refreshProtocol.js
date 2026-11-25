import { getAdapter } from "../db/driver.js";
import { applyProviderConnectionPatchInTx } from "../db/repos/connectionsRepo.js";
import { providerRefreshContext } from "../../shared/utils/providerCredentialContext.js";
import {
  acquireAntigravityLease,
  clearAntigravityLease,
  holdsAntigravityDispatch,
  markAntigravityDispatched,
  markAntigravityReauth,
  markAntigravityUncertain,
  newLeaseOwner,
  releaseAntigravityAttempt,
  renewAntigravityLease,
} from "./leaseSql.js";

function sessionFrom(db, lease) {
  let phase = "claimed";
  return {
    ok: true,
    lease,
    markDispatched() {
      if (phase !== "claimed") return false;
      const marked = markAntigravityDispatched(db, lease);
      phase = marked ? "dispatched" : "closed";
      if (!marked) releaseAntigravityAttempt(db, lease, { category: "busy", retryAfterMs: 0, dispatched: false });
      return marked;
    },
    renew() {
      if (phase !== "claimed" && phase !== "dispatched") return false;
      const renewed = renewAntigravityLease(db, lease);
      if (!renewed) phase = "closed";
      return renewed;
    },
    reauth() {
      if (phase === "dispatched") markAntigravityReauth(db, lease);
      phase = "closed";
    },
    backoff(retryAfterMs) {
      if (phase === "claimed" || phase === "dispatched") {
        releaseAntigravityAttempt(db, lease, {
          category: "rate_limit",
          retryAfterMs,
          dispatched: phase === "dispatched",
        });
      }
      phase = "closed";
    },
    uncertain() {
      if (phase === "dispatched") markAntigravityUncertain(db, lease);
      else if (phase === "claimed") {
        releaseAntigravityAttempt(db, lease, { category: "pre_dispatch_failure", retryAfterMs: 0, dispatched: false });
      }
      phase = "closed";
    },
    commit(patch, expectedRefreshContext, refreshToken) {
      if (phase !== "dispatched") return false;
      phase = "closed";
      let applied = false;
      try {
        db.transaction(() => {
          if (!holdsAntigravityDispatch(db, lease)) return;
          const result = applyProviderConnectionPatchInTx(db, lease.connectionId, patch, {
            expectedRefreshContext,
            returnCommitResult: true,
            antigravityLeaseCommit: true,
          });
          if (!result || result.applied === false) return;
          if (!clearAntigravityLease(db, lease, refreshToken)) {
            throw new Error("Antigravity lease clear failed");
          }
          applied = true;
        });
      } catch {
        applied = false;
      }
      if (!applied) markAntigravityUncertain(db, lease);
      return applied;
    },
  };
}

export async function openAntigravityLease(connection, { force = false } = {}) {
  const connectionId = connection?.id || connection?.connectionId;
  if (!connectionId || !connection?.refreshToken) return { ok: false, category: "pre_dispatch_failure" };
  const db = await getAdapter();
  const acquired = acquireAntigravityLease(db, {
    connectionId,
    refreshToken: connection.refreshToken,
    owner: newLeaseOwner(),
    force,
  });
  if (!acquired.ok) return acquired;
  return sessionFrom(db, acquired.lease);
}

export function isAntigravityProvider(provider) {
  return provider === "antigravity" || provider === "agy";
}

export async function exchangeAntigravityRefresh({ connectionId, credentials, dispatch, force = false }) {
  const session = await openAntigravityLease({
    id: connectionId,
    refreshToken: credentials?.refreshToken,
    provider: credentials?.provider,
  }, { force });
  if (!session.ok) return { blocked: true, category: session.category };
  if (!session.markDispatched()) return { blocked: true, category: "busy" };
  let detailed;
  try {
    detailed = await dispatch();
  } catch {
    session.uncertain();
    return { blocked: true, category: "uncertain_dispatch" };
  }
  if (detailed?.category === "invalid_grant") {
    session.reauth();
    return { error: "invalid_grant" };
  }
  // ponytail: 429 treated as non-consuming; upgrade if a provider trace shows rotation on 429.
  if (detailed?.category === "rate_limit") {
    session.backoff(detailed.retryAfterMs);
    return null;
  }
  if (!detailed?.ok || !detailed.tokens?.accessToken) {
    session.uncertain();
    return { blocked: true, category: "uncertain_dispatch" };
  }
  const tokens = detailed.tokens;
  const patch = { accessToken: tokens.accessToken, updatedAt: new Date().toISOString() };
  if (tokens.refreshToken && tokens.refreshToken !== credentials.refreshToken) patch.refreshToken = tokens.refreshToken;
  if (Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0) {
    patch.expiresIn = tokens.expiresIn;
    patch.expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  }
  const applied = session.commit(
    patch,
    providerRefreshContext({ ...credentials, id: connectionId, connectionId }),
    patch.refreshToken || credentials.refreshToken
  );
  if (!applied) return { blocked: true, category: "uncertain_dispatch" };
  return { ...tokens, rotationCommitted: true };
}
