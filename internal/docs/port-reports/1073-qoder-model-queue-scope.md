# 1073: Qoder model-queue outcomes stay scoped to the queued model

## Source

[OmniRoute #18572](https://github.com/cheaper-inference/OmniRoute/pull/18572), `fix(sse): a Qoder queue throttle (503 upstream_busy, upstream code 10605) no longer parks the whole connection`, pinned at `ec70441c52e73ad77062853bfb761ceb354560dd` (merged source).

Exact change: upstream `open-sse/services/accountFallback.ts` adds one line to `hasPerModelQuota()`:

```ts
if (canonicalId === "qoder") return true;
```

Upstream cools a whole connection on a 500/429/503 unless the provider is on that allowlist. Qoder multiplexes every model behind one connection and answers a queued request with `503 upstream_busy` naming the queued model, so the missing allowlist entry turned one queued model into a connection-wide cooldown and every sibling model of that account looked dead until the cooldown expired. The rest of the upstream diff is two test files and a changelog entry.

## Disposition: no code port needed

The upstream structure does not exist in DurinDoor, and the behavior the upstream change moves toward is already the current behavior: a Qoder queue outcome locks the queued model only, while the distinct typed outcomes (code 112 quota exhaustion, credential rejections) keep their own policy.

Local evidence (current checkout):

- No `hasPerModelQuota` allowlist exists here (`rg hasPerModelQuota` finds no runtime match). The local equivalent is the scope resolution inside `markAccountUnavailable` (`src/sse/services/auth.js:1377`) through `resolveFallbackModelScope` (`open-sse/services/fallbackScope.js:18`), which resolves the catalog model id of the failing request.
- `accountWide` is set only by a GitHub monthly-reset hint, a 429 with explicit exhaustion evidence on a provider whose `runtimeScopes.exhausted` is `"account"`, the opt-in `passthroughConnectionWideErrors` registry flag (only NVIDIA NIM sets it), or a provider error rule with `scope: "connection"` (`src/sse/services/auth.js:1611`). The Qoder registry entries (`open-sse/providers/registry/qoder.js`, `open-sse/providers/registry/qoder-cn.js`) set neither `passthroughModels` nor `passthroughConnectionWideErrors`, and `open-sse/config/providerErrorRules.js:87` has no Qoder rule. A Qoder queue 503 therefore resolves to `modelLock_<catalog model>`, never to the account-wide `modelLock___all`.
- Queue classification: `parseQoderQueueInfo` (`open-sse/shared/qoder/queue.js:99`) recognizes the upstream `10605` / `RESOURCE_LIMIT` / `isQueued` envelope, `peekQoderBillingFrame` (`open-sse/executors/qoder.js:386`) turns it into a retryable 503 with code `qoder_model_queued` (`open-sse/executors/qoder.js:501`), and `execute()` replays the queued request in place first — bounded by `QODER_QUEUE_MAX_ATTEMPTS` (6) and a 180 s budget (`open-sse/executors/qoder.js:890`, `open-sse/shared/qoder/queue.js:23`). Only the exhausted-queue 503 reaches the fallback layer, and it is already model-scoped there.
- The queue outcome is a distinct type from the quota and billing outcomes: `isQoderQuotaExhaustedBody` (`open-sse/executors/qoder.js:305`) matches only a top-level `code: "112"`, and `isBillingBlock` (`open-sse/executors/qoder.js:324`) matches `110` / `pricingUrl` and explicitly excludes `10605`.
- Quota classification keeps connection-wide policy: `isQoderQuotaExhausted` (`src/sse/services/auth.js:76`) disables the connection account-wide (`isActive: false`, `autoDisabledReason`, `testStatus: "unavailable"`) before any scope resolution. It requires HTTP 403 with a structured code-112 body, so a queue 503 can never reach it.
- Credential policy is unchanged: `isDurableCredentialProvider` (`open-sse/services/accountFallback.js:374`) lists only `orcarouter`, so a Qoder 401/403 keeps the ordinary cooldown path (model-scoped lock, connection stays active, no reauth quarantine), and no queue body can impersonate it.
- Persisted scope: `recordProviderConnectionFallbackState` (`src/lib/db/repos/connectionsRepo.js:557`) writes only the resolved scope's lock key plus the ordinary `testStatus` / `errorCode` / `lastError` fields; `boundedModelScope` (`src/lib/db/repos/connectionsRepo.js:488`) maps an unresolvable scope to the bounded `modelLock___all`.
- Combo: `open-sse/services/combo.js:1796` classifies every member failure with `checkFallbackError`. A queue 503 is a fallback-able transient failure (not request-scoped, not terminal), so the combo advances to the next member instead of ending the request, and the failed member's model keeps the lock recorded by the account layer.

## Not ported

- The upstream `hasPerModelQuota()` allowlist and its `lockModelIfPerModelQuota` / `isModelLocked` model-lockout map: no counterpart exists here, and adding one would duplicate the scope resolution that already produces the same outcome.
- Any change to credential or provider eligibility: the Qoder credential path, the registry flags, the quota/usage configuration and the error rules are untouched.
- The upstream error-code name `upstream_busy`: the fork's own retryable queue code is `qoder_model_queued`. Both are HTTP 503 with `type: "rate_limit_error"`, and the local classifier keys on the upstream `10605` envelope rather than on a code string, so the rename would not change any behavior.
- The bounded `modelLock___all` collapse for a model id outside the static catalog (for example an operator-added custom model): unchanged and provider-agnostic. It is the deliberate bounded-key design — request-chosen strings must not mint durable lock keys — and changing it would change provider eligibility for every provider, not only Qoder.

## Protection added

`tests/unit/omni-qoder-model-queue-scope.test.js` runs offline against a temp `DATA_DIR` database with no network:

- The mocked `10605` / `RESOURCE_LIMIT` / `isQueued` envelope parses as a queue signal and is neither a quota body nor a billing block, while code `112` and code `110` still classify as themselves.
- `checkFallbackError` classifies the queue 503 as fallback-able with `scope: null` (never `"connection"`), non-terminal, with no rate-limit evidence.
- `resolveFallbackModelScope` keeps the queued model and its siblings on separate scopes, and a model lock leaves the sibling models unlocked.
- Real `markAccountUnavailable` persistence for the queue 503: only `modelLock_qmodel_38max` is written, no `modelLock___all`, the connection stays active, and the sibling models stay unlocked.
- The code 112 outcome still disables the connection account-wide, and a 401 keeps the credential policy unchanged.
- An uncatalogued model string yields only the bounded `modelLock___all` key.
- `handleComboChat` advances past a queued member to the next member and serves the request.

Verification limits: offline mocked Qoder fields only (registry catalog ids, the upstream `10605` envelope, the fork's own queue/quota/billing bodies). No live provider, credential, paid API, browser, Docker or whole-suite run was performed.
