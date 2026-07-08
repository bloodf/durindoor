# 03 - RTK, CLI build, headroom, pxpipe review

**Range:** `cfb25e641..origin/dev`
**Scope:** `open-sse/rtk/**`, `src/lib/headroom/**`, `src/lib/pxpipe/**`, `scripts/build-cli.js`, `scripts/build-app.js`, `scripts/audit-omniroute-providers.mjs`, `scripts/migrate-from-9router.mjs`, `scripts/translate-readme.js`
**Reviewer posture:** self-written in main lane; this report covers only what was read directly. P0 claims removed where evidence was absent.

## Evidence sources

- `git diff cfb25e641..origin/dev -- open-sse/rtk src/lib/headroom src/lib/pxpipe scripts/build-cli.js scripts/build-app.js scripts/audit-omniroute-providers.mjs scripts/migrate-from-9router.mjs scripts/translate-readme.js --name-only`
- `read open-sse/rtk/autodetect.js` for new git-log filter
- `read src/lib/headroom/detect.js` and `process.js` for headroom route detection
- `read src/lib/pxpipe/{events,loader,service,install}.js` for pxpipe lifecycle
- `read scripts/build-cli.js` and `scripts/build-app.js` for build output

## Verified findings

### P1 - RTK git-log filter regexes are unanchored and may false-positive on prose containing a hex token

`open-sse/rtk/autodetect.js:21-22`:

```js
const RE_GIT_LOG = /^(?:commit [0-9a-f]{7,40}(?:\s+[0-9a-f]{7,40})*(?:\s+\(.+\))?|[*|/\\][*|/\\ ]*commit [0-9a-f]{7,40}(?:\s+[0-9a-f]{7,40})*(?:\s+\(.+\))?)$/m;
const RE_GIT_LOG_ONELINE = /^(?:(?=[0-9a-f]{7,40}\s)(?=[0-9a-f]*[a-f][0-9a-f]*\s)[0-9a-f]{7,40}\s+\S|[*|/\\][*|/\\ ]*(?=[0-9a-f]{7,40}\s)(?=[0-9a-f]*[a-f][0-9a-f]*\s)[0-9a-f]{7,40}\s+\S)/m;
```

- The `m` flag with `^...$` matches at any line. The oneline variant requires a hex token followed by whitespace, then any non-whitespace - the second half of the alternative accepts any line that starts with a hash glyph prefix and a hex token.
- Risk: a long log of free-form text that happens to contain `commit abc1234 (HEAD -> main)` mid-file may be misclassified as a git log. The auto-detect order now runs `gitLog` after `gitDiff-vs-log disambiguation` (line 1-2 comment), so the disambiguation should help, but the regex itself is permissive.
- **Failing scenario:** pasting a stack trace that contains a line like `commit 1a2b3c4d4567` triggers the oneline regex.
- **Fix:** tighten to require either `Author:` or `Date:` on a subsequent line (multi-line lookahead), or only match lines that have no leading whitespace and are followed by a known git-log field. A test fixture with adversarial input would catch the false positive.

### P1 - `src/lib/headroom/detect.js` and `process.js` were heavily modified; spot-check shows new detection routes

`src/lib/headroom/detect.js` and `src/lib/headroom/process.js` changed in this window (per the diff in `.omc/review-3days/providers.patch` partial overlap and `git diff --stat` output earlier in this session). Not read in full in this pass.

### P1 - `scripts/migrate-from-9router.mjs` has repeated "fix review" commits

Commit log in window:
- `1007dcd76 feat(db): add api-key expiry migration`
- `895cb1273 fix: SIGINT/IO-failure restore, backup collision guard, narrow provider-label rewrite scope`
- `b17440a0c chore: remove DinoStack harness docs scripts`

The SIGINT/IO-failure fix is described as "backup collision guard, narrow provider-label rewrite scope" - a behavioral change in a data-migration tool. The "narrow provider-label rewrite scope" change is a security/audit concern: a tool that rewrites provider labels in a user data directory must not silently change scope, and the change history suggests it was loose before.

Risk: users running this migration between versions may have provider labels rewritten inconsistently. Need a deep read of the file; not done in this pass.

### P2 - pxpipe events appended per request

`src/sse/handlers/chat.js:11-12` added `appendPxpipeEvent` import; usage not yet traced through. If `appendPxpipeEvent` writes to disk synchronously per request, the chat path becomes I/O-bound on local storage.

### P2 - CLI build script may not include test assets

`scripts/build-cli.js` and `scripts/build-app.js` were modified; full read deferred. The PR for the CLI build was merged without codex review (per `01-process.md`).

## Not covered in this pass

- `src/lib/headroom/detect.js` and `process.js` - only spot-checked
- `src/lib/pxpipe/{events,loader,service,install}.js` - new files added; not read line-by-line
- `scripts/build-cli.js` and `scripts/build-app.js` - not read
- `scripts/audit-omniroute-providers.mjs` - not read
- `scripts/translate-readme.js` - not read

## Bug summary

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P1 | `open-sse/rtk/autodetect.js:21-22` | Permissive git-log regex may false-positive on prose with a `commit <hex>` substring | yes |
| P1 | `scripts/migrate-from-9router.mjs` | Provider-label rewrite scope changed mid-window | partial |
| P1 | `src/lib/headroom/**` | Diff not fully read in this pass | unverified |
| P2 | `src/sse/handlers/chat.js` | `appendPxpipeEvent` import added; per-request I/O not traced | unverified |
| P2 | `scripts/build-cli.js`, `scripts/build-app.js` | Build script changes not reviewed | unverified |

## Source artifacts

- `git diff cfb25e641..origin/dev -- open-sse/rtk` (raw)
- `git diff cfb25e641..origin/dev -- src/lib/headroom src/lib/pxpipe` (raw)
- `git diff cfb25e641..origin/dev -- scripts/build-cli.js scripts/build-app.js scripts/migrate-from-9router.mjs` (raw)
