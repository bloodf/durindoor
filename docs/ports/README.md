# Upstream port inventories

Auditable coverage records for the cross-fork port cycles.

## `omniroute-week-2026-07-07.csv`

Complete inventory of every `diegosouzapw/OmniRoute` PR and default-branch commit
created in the window `2026-07-07T00:00:00Z .. 2026-07-15T00:00:00Z` (UTC),
classified by the deterministic ruleset (first match wins; rules 1-4 mechanical, rule 5 a per-candidate semantic inspection):

1. Number in the already-ported EXCLUDE / confirmed-DUPLICATE list → `DUPLICATE`.
2. Number known-404 upstream → `UNAVAILABLE`.
3. Number in the authoritative 50-ID PORT set → `PORT`.
4. Every changed file is OmniRoute-only infra/CI/docs/changelog/release/deps
   (checked against the PR's actual file list, not its title) → `SKIP:infra-only`.
5. Non-infra changes are a pure TypeScript type/interface with no runtime change
   → `SKIP:type-only`. (This window: 0 rows — every all-TS residual carries real
   runtime or test behavior, so none qualified.)
6. Otherwise → `SKIP:not-selected` (examined, out of the named-map scope).

Rules 1–3 are number-deterministic and fully decide every `PORT` and
`DUPLICATE` row. Rules 4–6 were applied to the residual using each PR's real
changed-file list (`gh pr view --json files` for all 335 residual rows, 0
errors); the 19 all-TS candidates were inspected and none was type-only, so the
rule-5 bucket is empty by evidence. A `SKIP` verdict is a coverage record, never
a portability claim. The authoritative behavior and target files for each `PORT`
row are derived per unit from the live `gh pr diff <N>` at port time — the source
PR diff, not this row's title, is the truth for what gets implemented.

Columns: `number,title,verdict,evidence`. `evidence` records the deciding rule
and, for `SKIP`, the subtype plus changed-file count. `commit:<sha>` rows are the
9 window default-branch commits (release/CI/deps → `SKIP`).

Verdict tallies for this window: 50 `PORT`, 41 `DUPLICATE`, 0 `UNAVAILABLE`,
344 `SKIP` (335 PR + 9 commit), 0 unclassified. SKIP subtypes: 300 not-selected,
34 infra-only, 1 no-files. The 50 `PORT` rows are the units selected for import into
`bloodf/durindoor:dev` as independent `port(omniroute): #N` PRs this cycle (merge status tracked per PR, not in this artifact).
