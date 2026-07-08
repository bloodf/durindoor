# 04 - Dashboard, SSE handlers, OAuth, network proxy review

**Range:** `cfb25e641..origin/dev`
**Scope:** `src/sse/handlers/**`, `src/sse/services/**` (apiKeyPolicy, auth, model, tokenRefresh), `src/app/api/**`, `src/lib/oauth/**`, `src/lib/network/**`, `src/lib/providerNormalization.js`, `src/lib/connectionProxy.js`, `src/lib/localDb.js`
**Reviewer posture:** self-written in main lane; only what was read directly. P0 claims removed where evidence was absent.

## Evidence sources

- `git diff cfb25e641..origin/dev -- src/sse/handlers src/sse/services --name-only`
- `read src/sse/handlers/chat.js` for new policy + pxpipe wiring
- `read src/sse/services/apiKeyPolicy.js` (already read in 03-db-migrations.md)
- `read src/lib/localDb.js` for the new `getApiKeyUsageTotals` / `getApiKeyUsageLimitStatus` exports
- `read src/lib/network/connectionProxy.js` first 30 lines

## Verified findings

### P0 - Per-API-key daily token limit and policy enforcement depends on missing DB migrations

- `src/sse/handlers/chat.js:9-10` and `:13-14` import `getApiKeyUsageLimitStatus` and `enforceApiKeyModelPolicy`.
- `src/sse/handlers/chat.js:138-148` blocks the chat if daily limit exceeded (returns 429).
- `src/sse/handlers/chat.js:152-154` blocks the chat if the model is not in the per-key allowlist (returns 403).
- The same policy is wired in 7+ other handlers per `03-db-migrations.md` evidence: embeddings, fetch, imageEdit, imageGeneration, moderations, rerank, search, stt, tts, video.
- However, `src/lib/db/migrations/index.js:4-9` does not import `004-api-key-expiry.js` or `005-api-key-policy.js`. So the schema columns the policy reads (`policy`, `expiresAt`, `apiKeyUsageTotals`) are not present in the versioned migration chain.

Consequence:
- A fresh DB has no `policy` column and no `apiKeyUsageTotals` table.
- `enforceApiKeyModelPolicy` reads `keyRecord.policy` and `usage.totalTokens`; both are `undefined`/0 on a fresh DB, so policy is a no-op and limits are always 0 (no limit ever triggers).
- `getApiKeyUsageLimitStatus` returns the totals; the handler then compares to a missing-or-zero `limitTokens`.
- Net: feature ships in code but does not work; users configure policies that silently do nothing.

This is the user-facing impact of the P0 in `03-db-migrations.md` (F1). The two findings are the same bug, surfaced from two directions.

### P1 - `src/lib/network/connectionProxy.js` new `normalizeString` + ~27 line insertion in a critical proxy path

`src/lib/network/connectionProxy.js:6-33` (per `git diff` excerpt) inserts 27 lines around `normalizeString`. Not read in full. The proxy sits between every request and an upstream provider; any silent normalization here changes what bytes reach the upstream and what bytes come back.

Risk: unverified - the diff was not read line-by-line. Need a focused review pass before the next release.

### P1 - `src/sse/services/apiKeyPolicy.js` has the `hasValidCliToken` salt as a constant

`src/sse/services/apiKeyPolicy.js:8`:

```js
const CLI_AUTH_SALT = "9r-cli-auth";
```

- A static string salt used to derive the CLI token via `getConsistentMachineId(CLI_AUTH_SALT)`.
- Any consumer that can read this file can produce a valid CLI token. The token is then used to bypass API key policy (`apiKeyPolicy.js:65-66`: `if (hasCli) return null;`).
- A static salt means anyone with read access to the repo (open source) can construct a token that satisfies `hasValidCliToken` on any install - it derives to the same machineId. The "machineId" in this case is the server's persistent id, not the client's.
- Risk: medium. The token is a per-install value, so an attacker would need both the salt and the install's machineId. But the salt being in the public source means an attacker can construct a valid token if they obtain the machineId, which is on disk at the well-known SQLite path.
- **Fix:** rotate the salt between major versions; document that the CLI token is bound to the local install and that the salt is intentionally public. Not a hard P0, but worth a comment.

### P1 - `src/lib/localDb.js` re-exports new symbols that may not be implemented

`src/lib/localDb.js:10-11`:

```js
getApiKeys, getApiKeyById, getApiKeyByKey, getApiKeyUsageTotals, incrementApiKeyUsageSync, ...
getApiKeyUsageLimitStatus, ...
```

- `getApiKeyUsageLimitStatus` is exported. Need to verify the implementation handles the case where `apiKeyUsageTotals` table does not exist (e.g. before migration 005 ran).
- If the function tries to SELECT from a non-existent table, it throws and the chat handler returns 500 instead of 429/200.
- Verified partially via `src/lib/db/repos/apiKeyUsageTotalsRepo.js` (already read in 03-db-migrations.md) - the function returns `{ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null }` if the row is missing, but does not guard against a missing table.

### P2 - `connectionProxy.js` and `network/` should be reviewed together

The diff excerpt shows new content. Without a full read, the only signal here is "this changed and the proxy is critical". Mark P2 pending a follow-up read.

## Not covered in this pass

- Full read of `src/sse/handlers/{chat,embeddings,fetch,imageEdit,imageGeneration,moderations,rerank,search,stt,tts,video}.js`
- Full read of `src/lib/oauth/**` (cursor auto-import, gitlab pat, xai oauth)
- Full read of `src/lib/network/connectionProxy.js` (only header)
- Full read of `src/app/api/**` (api-keys routes, providers routes, usage routes)

## Bug summary

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P0 | `src/sse/handlers/chat.js:9-14,138-154` + `src/lib/db/migrations/index.js:4-9` | Per-key daily limit + model policy enforcement is non-functional on a fresh DB (F1 cascade) | yes |
| P1 | `src/sse/services/apiKeyPolicy.js:8` | Static `CLI_AUTH_SALT = "9r-cli-auth"`; documented, not P0 | yes |
| P1 | `src/lib/localDb.js:10-11` | `getApiKeyUsageLimitStatus` re-exported; implementation may not guard missing table | partial |
| P1 | `src/lib/network/connectionProxy.js:6-33` | 27-line insertion in critical proxy path; not read | unverified |
| P2 | `src/app/api/**`, `src/lib/oauth/**` | Multiple new routes, not reviewed | unverified |

## Source artifacts

- `git diff cfb25e641..origin/dev -- src/sse/handlers src/sse/services` (raw)
- `read src/sse/handlers/chat.js`
- `read src/sse/services/apiKeyPolicy.js`
- `read src/lib/localDb.js`
