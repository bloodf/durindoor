# API-key rotation with stable accounting (#1072, upstream #5545)

Reviewed 2026-11-20 against local base `558e42f95`, following the stable-accounting ports that landed before it: `fix(usage): keep quota windows on stable API key IDs` and `fix(usage): preserve API key IDs on history rows`.

## Upstream

`decolua/9router#5545` ("feat(keys): rename and rotate API keys from the dashboard", commit `f14aefd57`) adds two things to 9router:

- `PUT /api/keys/{id]` accepts `name`, validated by a new shared `validateKeyName` that `POST /api/keys` also uses.
- `POST /api/keys/{id]/rotate` generates a new secret for the same key record. The id, name, access, `isActive` and `createdAt` are kept, the old secret stops validating, and a legacy `sk-{random8}` secret is upgraded to `sk-{machineId}-{keyId}-{crc8}`.

The upstream dashboard adds an inline rename, a rotate button with a confirm dialog, and reuses the created-key modal as "API Key Rotated" so the new secret is shown once.

## Local state before this port

- Rename already exists: `PUT /api/keys/{id}` trims and rejects an empty name, and the dashboard edits a key's name in the edit modal. The upstream shared `validateKeyName` (a 100-character ceiling) was **not** ported: it would change create and rename behavior that the local suite already pins, and the work order asks for the existing rename to be preserved.
- Accounting is keyed by the key's stable row id, not by its secret. `src/lib/db/helpers/apiKeyAttribution.js` resolves a usage row to `usageHistory.apiKeyId` (the admitted id wins over the stored secret), and `src/lib/apiKeyLimits.js` scopes the RPM, TPM, daily and monthly windows by that id. Migration 030 backfilled the id onto the rows that predate it.

That is the whole difference from upstream: a bare secret swap is already accounting-neutral here, because the account is the row and not the credential.

## Change

`rotateApiKey` in `src/lib/db/repos/apiKeysRepo.js` replaces the credential and nothing else:

- The read, the new secret and the write happen in one transaction. Only `apiKeys.key` and `apiKeys.machineId` change; the id, name, admin scope, policy, quota, combos, groups, provider connections, expiry and history stay on the row.
- The write is conditional on the secret the call observed (`WHERE id = ? AND key = ?`). Two rotations that race cannot both install their secret: the one that finds a changed row installs nothing and reports `conflict`. A caller therefore never receives a secret that is not installed.
- The generated secret is rejected when it equals the current one, so a rotation always changes the credential and the retired secret really stops validating.
- The retired secret is not written anywhere. There is no retired-secret table, no ledger row, no log line and no cache entry that holds it.

`POST /api/keys/[id]/rotate` in `src/app/api/keys/[id]/rotate/route.js` exposes it:

- The gate is `canManageAccessConfig`, the permission every key mutation already uses: an operator session (dashboard login, CLI token, open local dashboard) or an API key with the admin scope. A key without the admin scope is refused by the dashboard gate before the handler runs, and the handler refuses it again.
- The response carries the new secret once, in the same shape as the create response, plus the key's identity, its scopes and its usage totals. The retired secret is not part of it.
- `404` for an unknown key, `409` for a lost race, `500` for a failed write. No error path returns a secret.

The dashboard row gained a rotate button (`src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx`): it confirms first, then shows the new secret once in the modal that creation already used, now titled "API Key Rotated".

## Commit and delivery contract

The port as merged had a partial-success state. The route committed the swap and only then read the ancillary metadata (usage totals, provider connections, groups). A read that failed in that window answered `500` with no secret, while the swap was already committed: the retired credential was dead and the caller never received the replacement. Because the retired secret is never stored, that state cannot be recovered by the operator either.

The repair keeps the commit and the response in agreement:

- The ancillary reads run **before** the swap. They describe the key's row, and a rotation changes none of them, so reading them first costs no accuracy. A read that fails now aborts before anything is written: the response is `500`, the previous credential keeps working, and the caller can retry.
- Nothing fallible runs after the commit. The response body is assembled from values already in memory, so a committed rotation always delivers the replacement exactly once. `404` (unknown key) and `409` (lost race) still carry no secret, and neither path writes anything.
- The response is `Cache-Control: no-store`, the policy the other management credential responses (login, MFA, settings) already use. The body carries the credential once, so it must never be cached.
- A failure is logged without the raw error. A database or key-generation error can carry the row it touched, so only the class of the failure (`name`, `code`) is recorded. A `500` from this route now always means "nothing was committed".

The stable-id accounting, the permission scope, the response fields and the state of a failed swap are unchanged.

## Rejected alternatives

- **A retired-secrets table.** An earlier attempt at this port added `apiKeyRetiredSecrets` and made the accounting queries secret-aware. It contradicts the stable-accounting design and the rule that a retired credential must not reach a ledger, so it was dropped. With the stable id on every usage row, the accounting needs no knowledge of the old secret.
- **Scrubbing the retired secret from `usageHistory.apiKey`.** Usage rows written while the secret was live keep it, as they do for every key. A rotation adds no copy of it, and the value no longer authenticates. Rewriting history would change recorded data and would break the legacy attribution path for rows that still have no stable id.
- **An operator-only gate.** `GET /api/keys/{id}/reveal` stays JWT/CLI-only because it hands out a secret that already exists. Rotation hands out the credential the caller just created, exactly like `POST /api/keys`, which already returns the new secret to an admin-scoped key caller. The same permission is used for both.
- **Upstream's shared `validateKeyName`.** See "Local state before this port".
- **A CLI command.** The interactive CLI menu offers create, expiry change and delete, and upstream #5545 does not touch the CLI. The rotation is a dashboard action here; the CLI can call the same route later.

## Evidence

`tests/unit/api-key-rename-rotate-port.test.js` covers the route and the repository: the unauthenticated and unpermitted denial (no rotation happens), the one-time secret in the response, the unknown key, the lost race, the failed write, the identity and scope preservation, the immediate invalidation of the previous credential, the usage, daily-limit and in-memory rate window across the rotation, the late write of a request admitted before the rotation, the race between two rotations, the rollback of a rejected write and of a failing generator, the absence of any copy of the retired secret, and the upgrade of a legacy secret.

`tests/unit/api-key-rotation-commit-response.test.js` covers the commit/response agreement added afterwards: the synthetic repository success (the replacement is delivered, the retired credential stops validating, the stable id and its usage stay on the key), the ancillary read rejection (the swap never runs and the previous credential keeps working), the proof that nothing is read after the swap, the `no-store` policy on the success and failure responses, the raw-error-free log, the unknown-key and denied paths, the lost race, and the rollback of a refused write.

Focused evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/api-key-rename-rotate-port.test.js unit/api-key-rotation-commit-response.test.js unit/api-key-stable-usage-accounting.test.js unit/api-key-stable-limit-accounting.test.js unit/api-keys-route.test.js unit/api-keys-reveal-route.test.js unit/1300-v5-storybook-inventory.test.js --maxWorkers=2` passes. Root lint passes. The fixtures are synthetic; no provider, browser or media request was made. The integration gate owns the full suite.
