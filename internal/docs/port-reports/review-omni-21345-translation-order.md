# Review: OmniRoute #21345 translation order

Date: 2026-11-27. Status: DONE. Static review only; no code, tests, installs, services, or providers were run.

## Verdict

**Inapplicable: the upstream surface is absent from DurinDoor.** No port is needed and no production code was changed. Evidence and a re-review trigger are below.

## Upstream facts (read-only `gh api`)

- PR: [cheaper-inference/OmniRoute#21345](https://github.com/cheaper-inference/OmniRoute/pull/21345), `fix(translator): list recent translations newest first (KEA-9583)`, state open, not draft.
- Base: `release/v3.8.55` at `9671192011beb2d7f83979f40be488c5da8772b9`.
- Head: `fix/kea-9583-translator-history-order` at `8fbe4785be1d6be723bf7e2e0a58bfa04ff27cde`. This matches ledger row O0064 in `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1732`, so the head is unchanged.
- Changed files (3):
  - `src/lib/translatorEvents.ts` (modified, +9/−1): `getTranslationEvents` now sorts a copy of the buffer by `timestamp` (newest first, invalid timestamps last) before applying `limit`.
  - `tests/unit/translator-events-order.test.ts` (added, +35).
  - `changelog.d/fixes/kea-9583-translator-history-order.md` (added).

## DurinDoor comparison (git objects)

Compared `origin/main` (`29490b783e`) and the frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`. Both trees give the same result.

- **No translator event buffer.** `git ls-tree` finds no `translatorEvents` or `translation-events` module. `git grep` finds no `logTranslationEvent`, `getTranslationEvents`, or `TranslationEvent` in `src`, `open-sse`, or `tests`. The only "translation" hits are the audio `/v1/audio/translations` endpoint and comments in `open-sse/translator/`.
- **No Monitor / Recent Translations surface.** The Translator page is `src/app/(dashboard)/dashboard/translator/page.js` with `TranslatorWorkspace.jsx`, titled "Translator Debug" (a replay of the request-flow steps). It has no Monitor tab and no recent-events list. The `/api/translator/*` routes are `send`, `translate`, `load`, `save`, and `console-logs`.
- **The console-log buffer does not match the defect pattern.** `src/lib/consoleLogBuffer.js` stores formatted line strings in arrival order (`state.logs.push(line)`, `getConsoleLogs()` returns the ring in order). It has no per-entry timestamp and no sort-then-limit step, so the bug class (an event carries its own timestamp, the limit applies before sorting) cannot occur there.
- **Ledger and claims.** Row O0064 is recorded as "Unrecorded at this head; review required". This review resolves that row. A GitHub issue/PR search for `21345`, `KEA-9583`, and "recent translations" on `bloodf/durindoor` returned nothing, so there is no active claim. The PR is outside the auth lane and the sync lane (#21435/#21432/#21426/#21412/#21425/#21427/#21349/#21433, 9router #5884/#5904, `usage.js`), so there is no overlap.

## Reproducible check, if the surface is later added

The fix is only meaningful where a translator event log carries per-event timestamps and a `getTranslationEvents(limit)`-style reader. To verify parity at that point, run the upstream test against the DurinDoor module:

```bash
# after the module exists in DurinDoor; the test imports ../../src/lib/translatorEvents.ts
node --test tests/unit/translator-events-order.test.ts
```

Expected: with `limit=1` the newest-timestamp event (`newest`) is returned, and with the full window the order is `newest, middle-last, middle-first, oldest, invalid`. The current tree has no such file, so this check cannot run here and is not claimed.

## Re-review trigger

Re-open this item only if DurinDoor adds a translator event buffer or a Monitor / Recent Translations view that sorts or limits events by a per-event timestamp.

## Not verified

- Upstream `release/v3.8.55` file contents were checked only through the PR patch context (`src/lib/translatorEvents.ts` around line 31). The base file was not fetched in full.
- No tests were run. Installs were not needed for static inspection.
