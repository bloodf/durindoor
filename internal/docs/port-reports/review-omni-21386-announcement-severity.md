# Review: OmniRoute #21386 announcement severity

Reviewed 2026-11-27. Source inspection only; no code changed, no dependencies installed, no product execution.

## Verdict

**Intentional / inapplicable. No defect, no missing behavior claimed.**

DurinDoor has no upstream news or announcement surface for this PR to extend. The PR only adds an opt-in severity and expiry layer on OmniRoute's own news feed (`news.json`, `public/announcements/v3.json`, both fetched from `cheaper-inference/OmniRoute` `main`) and on its Home banner and Changelog news viewer. DurinDoor has deliberately recorded that this news-feed surface needs no DurinDoor equivalent, and points its own changelog at its own repository.

Severity: none.

## Upstream identity (read-only `gh api`, 2026-11-27)

- PR: `cheaper-inference/OmniRoute#21386`, "feat(dashboard): add severity and expiry to public announcements (opt-in)"
- State: open, not draft, not merged, `updated_at` 2026-11-27T03:38:16Z
- Base: `release/v3.8.55` @ `9671192011beb2d7f83979f40be488c5da8772b9`
- Head: `feat/dashboard-announcement-severity` @ `2aadcdd1076f2debf9dfe200de31e16a06feb48b` (matches the ledger row `O0028`)
- 18 changed files, 1676-line diff. Files: `public/announcements/v3.json` (added), `src/shared/utils/releaseNotes.ts`, `src/app/(dashboard)/dashboard/NewsBanner.tsx`, `NewsSeverityBadge.tsx` (added), `changelog/components/NewsViewer.tsx`, `src/shared/hooks/useNewsFeed.ts` (added), a flag definition, i18n, docs, and tests.

## What the upstream PR changes

- Base `src/shared/utils/releaseNotes.ts:4-8` defines `NEWS_JSON_URL` and `CHANGELOG_RAW_URL` on `raw.githubusercontent.com/cheaper-inference/OmniRoute/main`. Base `NewsBanner.tsx` renders the `news.json` items on Home.
- The PR adds `NEWS_V3_JSON_URL` (same host, `public/announcements/v3.json`), a 64 KiB and 5 s limit, fallback to `news.json`, and a `ANNOUNCEMENT_SEVERITY_ENABLED` flag that defaults to `false`.
- Its own text describes the v2 feed as `news.json`. A contents lookup for `public/announcements/v2.json` at the base SHA returned 404, and `useNewsFeed.ts` is a new file in the PR. I did not verify base file contents beyond the URL lines above.

## DurinDoor current state

Checked `origin/main` @ `29490b783e83176d4d6a4162f76ee3dc79db66ea` (the train head at review time) and local `HEAD` @ `d27f288cb59be43a4c1068ac314076cde0297413`. Both have the same result.

- No `news.json`, `public/announcements/`, `NewsBanner`, `NewsViewer`, `useNewsFeed`, `releaseNotes`, `NEWS_JSON_URL`, or `ANNOUNCEMENT_SEVERITY` in `src`, `public`, `scripts`, `tests`, `docs`, or `.github`. Reproduce: `git grep -n -E 'public/announcements|NewsBanner|news\.json|NEWS_JSON_URL|ANNOUNCEMENT_SEVERITY|fetchNewsPayload' origin/main -- src public scripts tests docs .github` returns nothing.
- No dashboard changelog route exists under `src/app/(dashboard)/dashboard/` on `origin/main`.
- The only changelog surface is a modal. `src/shared/components/ChangelogModal.js:67` fetches `GITHUB_CONFIG.changelogUrl`, which `src/shared/constants/config.js:12` sets to `raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/CHANGELOG.md`. `src/shared/components/HeaderMenu.js:93` mounts it.
- History: `git log -S NewsBanner` and `-S NEWS_JSON_URL` hit only port-report table text, never code. No commit adds or removes an announcement or news component in code.

## Prior DurinDoor disposition of the same surface

- `internal/docs/port-reports/1073-nov25-evening-commits-4.md:28`: upstream `fb65123816c4d246044a7b52fd868d860bc2c9ad`, "feat(news): add the Radar free-catalog item, inactive", recorded as **not applicable**: "no equivalent news-feed product surface is required in DurinDoor."
- Same file, line 27 (`e731beff…`, test pin for the same item) and line 31 (merge of the release train into the news branch) are also not applicable.
- `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1696`: `O0028` (#21386) is listed as "Unrecorded at this head; review required", assigned to batch `parity-review-prs-04` at line 2320. This review closes that row.

## Owner overlap

- Sync-lane owners #21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433 and 9router #5884/#5904 do not cover the news or announcement surface. The owner numbers that appear in the Nov 27 post-#2686 refresh cover free-catalog provider items, not announcements.
- A read-only `gh issue list` search for "21386 OR announcement OR severity" on `bloodf/durindoor` returned only broad tracking issues (#2331, #1056). I did not read their bodies in full. The search snippets showed no claim on #21386.

## Why not a port

- Porting would add a DurinDoor-owned announcement channel. Its feed would have to be a DurinDoor-owned file or URL. The upstream URLs (`cheaper-inference/OmniRoute` `main`) must not be reused, because they would show another project's announcements in this fork.
- Nothing in the repo asks for such a channel. The only recorded decision says the opposite.

## Uncertainty

- The "not applicable" precedent is for the Radar news commits, not for the severity feature itself. I extend it to the whole news surface. If the product owner wants a DurinDoor announcement channel, that is a new decision and this verdict would need revisiting.
- Older Aug–Oct reports leave Radar launch and news rows (`#9926`, `#1730`, `#1734`, `#10418`) as "UNRESOLVED". This verdict does not resolve those rows.
- I did not run tests or the product. Both were unnecessary for a source-presence verdict.
