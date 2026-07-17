# Port log: upstream 9router PR #2605

- **Source:** https://github.com/decolua/9router/pull/2605
- **Port branch:** `port/upstream-2605`
- **Base (clean) SHA:** `397d54b6a42c4056d7f375cc51c0567c5a4b71ff` (`origin/dev` at port time)

Upstream PR resolves 25 pre-existing unit failures across 6 disjoint modules
(DB / OAuth / translator / image / combo / antigravity) plus an O(1) model-lookup
perf change. Per-case preflight against the clean base SHA found five of the six
rows **already passing on dev** (behavior present — duplicates, not ported). Only
the **DB** row reproduced a real defect on dev and was ported.

## Per-case ledger (clean-base preflight → verdict)

| Upstream row | Focused test(s) on dev | Clean-base result | Verdict |
|---|---|---|---|
| DB (`usageRepo.saveRequestUsage` dedupe) | `db-concurrent`, `api-key-usage-accounting` | identical-payload writes collapsed (probe: 2/100 inserted) | **PORTED** |
| OAuth (cursor auto-import realign) | `oauth-cursor-auto-import` | 8/8 green | SKIP: duplicate |
| Translator (collapse/flatten/NDJSON/inline delta) | `translator-request-normalization`, `openai-to-claude` | 8/8 + 10/10 green | SKIP: duplicate |
| Image (prefetch + PNG hardening) | `codex-image-fetch`, `image-fetch-hardening` | 4/4 + 9/9 green | SKIP: duplicate |
| Combo/headroom | `combo-capabilities`, `combo-routing`, `headroom` | 18/18 + 4/4 + 12/12 green | SKIP: duplicate |
| Antigravity/retry | `antigravity-mitm`, `antigravity-capacity-fallback` | 12/12 + 6/6 green | SKIP: duplicate |

## Behavior ported (DB only)

`saveRequestUsage` now unconditionally INSERTs each request inside the existing
atomic transaction. Removed the read-then-conditionally-insert dedupe that matched
on byte-identical field payloads (same timestamp + provider + model +
connectionId + apiKey + tokens) and silently dropped parallel/duplicate writes —
the masked `db-concurrent` test only passed because it used a unique
`connectionId` per row. An explicit `usageEventId` idempotency key still dedupes
true retries of the SAME logical event (preserved, asserted by
`api-key-usage-accounting.test.js`).

## Files (3)

- `src/lib/db/repos/usageRepo.js` — production fix
- `tests/unit/api-key-usage-accounting.test.js` — regression: identical payloads
  without `usageEventId` are distinct events (3 insert); `usageEventId` retries dedupe
- `docs/ports/upstream-2605.md` — this log

## Verification

Vitest JSON reporter (`numPassedTests/numTotalTests`), all 12 focused files:

```text
cd tests && node_modules/.bin/vitest run --reporter=json \
  unit/oauth-cursor-auto-import.test.js unit/translator-request-normalization.test.js \
  unit/openai-to-claude.test.js unit/codex-image-fetch.test.js \
  unit/image-fetch-hardening.test.js unit/combo-capabilities.test.js \
  unit/combo-routing.test.js unit/antigravity-mitm.test.js \
  unit/antigravity-capacity-fallback.test.js unit/headroom.test.js \
  unit/db-concurrent.test.js unit/api-key-usage-accounting.test.js
TOTAL: 102/102 passed, 0 failed
```

Per-file (verbose pass counts):

```text
oauth-cursor-auto-import: 8   translator-request-normalization: 8
openai-to-claude: 10          codex-image-fetch: 4
image-fetch-hardening: 9      combo-capabilities: 18
combo-routing: 4              antigravity-mitm: 12
antigravity-capacity-fallback: 6  headroom: 12
db-concurrent: 8              api-key-usage-accounting: 3
```

DB focused pair (after fix):

```text
unit/db-concurrent.test.js unit/api-key-usage-accounting.test.js
Test Files  2 passed (2)
Tests       11 passed (11)
```
