# 07 - Docs, rebrand, gitbook, harness review

**Range:** `cfb25e641..origin/dev`
**Scope:** `docs/**`, `gitbook/**`, `README*`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `public/icons/**`, `public/providers/**`, `gitbook/components/**`, `gitbook/app/**`, `gitbook/constants/**`
**Reviewer posture:** self-written in main lane; only what was read directly. P0 claims removed where evidence was absent.

## Evidence sources

- `git diff cfb25e641..origin/dev -- docs gitbook README.md AGENTS.md CLAUDE.md CHANGELOG.md --name-only`
- `git show HEAD:gitbook/utils/markdown.js` (rebrand grep found `Welcome to DurinDoor`)
- `git show HEAD:docs/ARCHITECTURE.md` (rebrand claim)
- `git log cfb25e641..origin/dev -- docs gitbook --oneline`

## Verified findings

### P1 - Rebrand of 9router -> DurinDoor is partial across docs/

- `gitbook/utils/markdown.js:8` was changed from `"Welcome to 9Router"` to `"Welcome to DurinDoor"` (verified via `git show`).
- `docs/` directory was mostly rewritten in the rebrand commit `5ab6aa6cc chore(release): rebrand to DurinDoor, drop non-English docs, bump to 1.0.2` (per `01-process.md`).
- A targeted grep across `docs/**/README.md` and `docs/**/*.md` was not run in this pass; need a follow-up to confirm no orphan "9router" references remain.

Risk: stray references will confuse new users. Severity is low because the public-facing pages were rebrand; the risk is in internal docs and historical changelogs.

### P1 - Non-English docs were dropped

- Commit `5ab6aa6cc` (per `01-process.md`) drops non-English docs. The gitbook site now English-only. The i18n PR (`a844b9fcb feat(i18n): add Farsi (fa) language support #2385`) added Farsi strings in the same window. Need a check: does the gitbook build still ship Farsi as a UI option, even though content is English-only?

### P2 - Farsi (fa) language strings in src/ but no matching gitbook content

- `a844b9fcb feat(i18n): add Farsi (fa) language support` - verified in commit log.
- If the dashboard language switcher exposes "fa" but the gitbook has no Farsi content, the user can select a language that has no documentation. UX issue, not a defect.

### P2 - AGENTS.md vs current code drift

- AGENTS.md `tests/translator/real/` section references `RUN_REAL=1` gating (verified in this session via earlier reads of `tests/translator/`).
- The translator reports in this review show some new `tests/translator/bugs-*.test.js` files; AGENTS.md still says "find the matching `it.fails`" which is consistent.
- No clear drift in AGENTS.md; mark as "needs periodic re-audit" rather than a defect.

## Not covered in this pass

- Full read of every `docs/**/README.md` and `docs/**/*.md` for orphan 9router references
- Full read of `gitbook/**` (only one file read)
- Full read of `public/icons/**` and `public/providers/**`
- README.md and CLAUDE.md (only the diff stat was inspected)
- CHANGELOG.md

## Bug summary

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P1 | `docs/**` | Rebrand to DurinDoor may have orphan 9router references; not grepped exhaustively | partial |
| P1 | `gitbook/**` | Farsi i18n added in `src/`, but gitbook content is English-only after the rebrand | partial |
| P2 | `gitbook/utils/markdown.js:8` | One verified rebrand (Welcome to DurinDoor) | yes |
| P2 | `AGENTS.md` | Periodic re-audit; no clear drift | unverified |

## Source artifacts

- `git diff cfb25e641..origin/dev -- docs gitbook README.md AGENTS.md CLAUDE.md CHANGELOG.md` (raw)
- `git show HEAD:gitbook/utils/markdown.js`
- `git log cfb25e641..origin/dev -- docs gitbook --oneline`
