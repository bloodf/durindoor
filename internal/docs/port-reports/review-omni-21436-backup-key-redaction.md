# Review: OmniRoute #21436 — keep the system API key secret out of downloadable backups (KEA-9523)

Status: **Intentional / inapplicable.** No DurinDoor gap. No production code changed.

## Scope and identity

- Upstream: [cheaper-inference/OmniRoute#21436](https://github.com/cheaper-inference/OmniRoute/pull/21436), open, not draft.
  - Title: `fix(api): keep the system API key secret out of downloadable backups (KEA-9523)`.
  - Head `feat/kea-9523-system-key-backups` at `6a154fec4aa9e1e20aab544ba62573b366fbfe57`; base `release/v3.8.55` at `44812b66fdff9e420d92aee4645a61546fe89f43`.
  - 47 changed files, +2239 / −321. Metadata read with read-only `gh api` on 2026-11-27.
  - The PR body states it is stacked: "Depends on #21385 (→ #21382 → #21352)". It must land after those three.
- DurinDoor comparison points, by Git object:
  - `origin/main` = `29490b783e83176d4d6a4162f76ee3dc79db66ea`.
  - Frozen train tree = `32a783d76d45d90bf0517015442f43fadd96106c`.
  - Worktree HEAD = `c8a757e8c0686aad4338071fc4d6a6283b7c2682`, which is a merge of the integration branch.

## What the upstream PR changes

1. `GET /api/db-backups/export` (raw `.sqlite` download) and `GET /api/db-backups/exportAll` (`.tar.gz`) scrub `source = "system"` rows (`key` replaced by a marker, `key_prefix` emptied) before streaming.
2. The scrub relies on `api_keys.source`, `key_prefix` and `key_hash`, and on new modules `src/lib/db/apiKeys/systemKey.ts` and `src/lib/db/apiKeys/projection.ts`.
3. It also edits `src/shared/utils/requiredApiKeyContext.ts`, `src/shared/utils/apiKeyPolicy.ts`, `src/lib/db/apiKeys.ts`, and the other #21385-chain files. Those files are listed in the PR's changed-file list.

## DurinDoor evidence

### 1. No system-owned key concept exists

- `origin/main`: no `source` column on `apiKeys`. The only `ALTER TABLE apiKeys` migrations are `004-daily-token-limit.js:9` (`dailyLimitTokens`), `005-api-key-expiry.js:14` (`expiresAt`), and `006-api-key-policy.js:14` (`policy`).
- `origin/main`: no `key_prefix`, `keyPrefix`, `key_hash`, or `systemKey` anywhere under `src/`. The `keyHash` hit at `src/lib/db/helpers/usageDailyRollups.js:13` is an unrelated rollup column.
- Train tree `32a783d76d45`: the same. `git grep` for `systemKey`, `requiredApiKey`, `key_prefix`, `keyPrefix` and `source === "system"` returns no `src/` hits.
- `src/lib/db/repos/apiKeysRepo.js` stores `key` as a plain column and maps it straight through `rowToKey`. It has no system or source branch.

### 2. No downloadable SQLite or archive backup route exists

- `git ls-tree origin/main src/app/api` contains no `db-backups` directory.
- No `Content-Disposition` in `src/app/api` serves database contents. The only attachments are `src/app/api/logs/export/route.js:112` and `src/app/api/v1/files/[id]/content/route.js:38`.
- The only database export is `GET /api/settings/database` (`src/app/api/settings/database/route.js:101`). It is dual-auth gated and returns JSON from `exportDb`.

### 3. The existing JSON export already omits the bearer secret by default

- `src/lib/db/index.js:473`: `if (!includeSecrets) delete keyRow.key;`. This is the baseline behavior the upstream PR's "scrubbed" concept would mirror. It is already present.
- `src/app/api/settings/database/route.js:114-115`: `includeSecrets` is read from the query string, and only `?includeSecrets=true` passes it to `exportDb`. That path also requires dual auth (`requireDatabaseDualAuth`, lines around 36-50).
- The existing opt-in export (`includeSecrets=true`) carries plaintext `apiKeys[].key` for ordinary keys. That is the intended behavior for a full migration backup, and the upstream PR also keeps ordinary keys unchanged.

### 4. Prior dispositions agree

- The upstream chain root is #21198 (`requiredApiKeyContext`). `1073-nov25-port-amprs-b.md:9` records it as not applicable, because `src/shared/utils/requiredApiKeyContext.ts` and the enterprise Playground caller are absent here.
- `1073-nov26-am.md:60,71,74` and `2026-11-26-morning-upstream-delta.md:48,59,62` record the same disposition for the merges that carry that chain.
- `2026-11-27-full-parity-refresh.md:1697`, `:1699`, `:1700` and `:1727` list #21385, #21383, #21382 and #21352 as "Unrecorded at this head; review required". Those rows are not claims. They are open review items, and this review does not change them.

### 5. Claims

- No active claim on #21436 was found in `internal/docs` or the train tree. Searches covered `21436`, `21385`, `21382`, `21352` and `KEA-9523`.
- The stacked prerequisites (#21385, #21382, #21352) are not in the sync or auth lane lists named in the lane brief. This review therefore does not claim them either.

## Residual observation (not a gap)

- `src/lib/db/backup.js:54` (`backupFile`) and `:76` (`backupDbLite`) copy the live database, including plaintext `apiKeys.key`, into `currentBackupsDir()` as safety backups.
- Those copies are written by `src/lib/db/migrate.js` and `src/lib/db/cutover.js`. No route in `src/app/api` serves that directory; `currentBackupsDir` is referenced only from `src/lib/db/backup.js`, `src/lib/db/cutover.js` and `src/lib/db/dialects/postgres/snapshot.js`.
- The upstream PR does not touch these safety copies either. This is recorded as an operator-filesystem consideration, not a download-path leak. Severity: low, no action from this review.

## Verdict by criterion

| Upstream behavior | DurinDoor state | Verdict |
|---|---|---|
| Scrub `source="system"` secrets from `.sqlite` download | No `.sqlite` download route; no system keys | Intentional / inapplicable |
| Scrub system secrets from `exportAll` archive | No archive route | Intentional / inapplicable |
| Drop bearer `key` from default portable export | Already done: `src/lib/db/index.js:473` | Present |
| Keep ordinary keys unchanged in backups | Present: `includeSecrets` opt-in, dual auth | Present |
| Restore behavior for unavailable system keys | No system keys to restore | Intentional / inapplicable |

No behavior gap was found. Nothing in this PR needs a DurinDoor port at this time. If the #21385 system-key chain is ported later, this PR's backup scrub would need to be re-reviewed against the `/api/settings/database` JSON export and the safety copies above.

## Reproducible static checks

Run from the repository root, against the commit that is checked out:

```sh
git show origin/main:src/lib/db/index.js | sed -n '473p'                 # delete keyRow.key when !includeSecrets
git show origin/main:src/app/api/settings/database/route.js | sed -n '114,115p'
git ls-tree -r --name-only origin/main | grep -c '^src/app/api/db-backups/' # expect 0
git grep -n -E 'systemKey|key_prefix|source === "system"' origin/main -- src   # expect no hits
```

Not run: no dependency install, no test execution, no service, provider, credential or gateway use. All evidence is from Git objects and the read-only GitHub API.
