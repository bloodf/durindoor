# Contributor contract

This file is the contract for people changing DurinDoor, a fork of `decolua/9router`. Read it before you edit routing or tests.

## Repo map

- `src/`: Next.js dashboard and the `/v1` gateway.
- `open-sse/`: provider routing, translation, and executors.
- `cli/`: npm launcher published as `durindoor`.
- `website/`: public site plus a mocked dashboard demo.
- `docs/`: published user and operator Markdown.
- `internal/docs/`: repository-only AI and maintainer references. Start with `internal/docs/README.md`; brand and porting guides are not published.
- `tests/`: Vitest suite. It is its own package, not wired to root `npm test`.
- `scripts/`: generators and CI checks, including `gen:registry-index` and `gen:agent-index`.

## Rules for changes

A behavior change needs a doc update and a test. Docs can be JSDoc, a README, a `docs/` page, or a short note next to the change. Tests go in `tests/unit/` or `tests/translator/`. Pure docs and CI edits can skip tests.

Commit subjects follow Conventional Commits in `.commitlintrc.cjs`. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `revert`, `merge`, `port`, `sync`. Subject text maxes out at 100 characters. Body lines should stay under 200. Use `port(upstream): #N - title` for 9router ports and `port(omniroute): title` for OmniRoute ports. Upstream release tags matching `# vX.Y.Z (...)` skip commitlint. Our own `sync:` commits still have to pass commitlint.

Do not hand-edit `open-sse/providers/registry/index.js` or `open-sse/AGENT-INDEX.md`. Run `npm run gen:registry-index` and `npm run gen:agent-index` instead. Do not add lines to `tests/__baseline__/known-fails.txt`. Do not rewrite stored API key secrets. Do not push to `main`. Leave `~/.9router` and `~/.9router-backup-*.tar` alone.

## Translator conventions

`open-sse/translator/` pivots through OpenAI. Requests go source to OpenAI to target. Response chunks go the other way. Matching source and target skip translation.

- Fragile pairs need a direct route such as `claude:kiro`. The OpenAI hop drops thinking blocks, tool ids, non-base64 images, and `tool_result.is_error`.
- New translator files only run after they are imported in `open-sse/translator/index.js`, which is what fires `register(from, to, requestFn, responseFn)`.
- Tests that call `translateRequest` or `translateResponse` must `import "./registerAll.js"` at the top of the file.
- Role, block, and model strings come from `open-sse/translator/schema/` and `open-sse/config/`. Do not hardcode them.
- `open-sse/rtk/` compresses `tool_result` bodies in place and fails open: on error it returns null and leaves the body untouched. It skips `is_error` and `status:"error"` results.
- RTK normally runs on the translated (target-format) body in `chatCore.js`, after `translateRequest`. Cursor is the one exception: its translator (`translator/request/openai-to-cursor.js`) rewrites `role:"tool"` / Claude `tool_result` blocks into plain `<tool_result>` user text, so a post-translate pass has no tool-result shape left to compress. `chatCore.js` runs RTK on the source-format body for `provider === "cursor"` before that rewrite, and skips the post-translate call for that request so the body is never compressed twice.

## Test workflow

Install root deps, then the deps under `tests/`. Pass `--config tests/vitest.config.js` unless you already run from `tests/` (Vitest picks that config up on its own).

```bash
cd tests && npm run test:ci
```

That command is the CI gate. It writes a Vitest JSON report and feeds it to `tests/__baseline__/verify-no-regression.mjs`. `tests/__baseline__/known-fails.txt` is empty in this tree, so every failing assertion is a regression. Do not add entries.

Offline translator tests need no credentials. `tests/translator/real/` runs only with `RUN_REAL=1` and reads connections from `~/.9router/db/data.sqlite`. Account and quota errors there are skipped; protocol failures are not.

Bugs that still exist in the app use `it.fails(...)` in `tests/translator/bugs-*.test.js`. After a fix, switch that row to `it` and run the file.

## PR checklist

Target `bloodf/durindoor:main`. Do not send PRs to `decolua/9router:dev` from this fork.

`npx commitlint --from=origin/main --to=HEAD` must exit 0. The PR title must also pass `echo "<title>" | npx commitlint`, because squash-merge uses the title as the commit subject.

PRs require root lint and independently reviewed scoped checks, or a full checkpoint when the risk floor requires it. The body lists scope, exact base/head, tests, docs, and baseline impact. One branch per PR. Never force-push without explicit authorization.

## Local gate authority

`scripts/local-ci.mjs` defaults to `--mode full`, preserving lint/build, conditional website, complete test inventory, report and commitlint jobs. Bootstrap must pass the full gate on the exact independently reviewed head before scoped policy can merge. The reviewed sequential-command amendment below replaces only the monolithic test command; bootstrap need not first pass that superseded command. Full checkpoints also run after upstream integration, every five merges, each stage boundary, final readiness, and shared-core/security/DB/dependency changes. An empty baseline remains mandatory.

Scoped mode accepts only an independent reviewer's frozen JSON selection. It binds `base`, `head`, `policySha256`, `runnerSha256`, `reviewer`, and literal `tests` paths. Supply the independently frozen hashes with `--policy-sha` and `--runner-sha`; an author-supplied reviewer string is not approval. The trusted integration owner obtains review evidence outside the candidate, freezes the runner and its imported baseline helpers from a reviewed checkout, and verifies receipt files and hashes before publishing `V5 Local CI`. Never execute a candidate runner to approve itself. This runner never publishes statuses or accesses GitHub credentials.

The deterministic floor permits scoped documentation checks for Markdown under `docs/` or `internal/docs/`, except the three policy documents. Translator request/response implementations and test files require all base-inventory offline translator tests plus mapped media/native/tool-result/streaming callers. The exact upstream-watch domain (`scripts/upstream-ported-ids.sh`, `tests/unit/upstream-watch-filter.test.js`, `internal/docs/upstream-sync.mdx`) requires the base-inventory `unit/upstream-watch-filter.test.js`, plus `unit/upstream-watch.test.js` when present, recorded `bash -n scripts/upstream-ported-ids.sh`, root lint and docs checks. Its workflow, ledger and other helpers are not scoped. Any deletion, missing mandatory caller, translator registration/schema/shared helper or policy change requires full mode. Reviewer additions can broaden but never narrow that floor. Unknown paths, mixed domains, contributor policy, gate/test selection, auth/crypto/money/admission, DB, registry, dependencies, toolchain, website and build inputs require full mode. Provider registry changes also need owner-run schema/catalog/generated-index checks; security/accounting changes require frontier review and relevant cross-route/concurrency/DB-engine evidence.

Run focused tests directly from `tests/` with `node node_modules/vitest/vitest.mjs run <explicit-files> --maxWorkers=2`. Root runs require `--config tests/vitest.config.js`. Do not pass selectors to `npm --prefix tests run test:ci`: its wrapper does not forward them. Scoped evidence is not global coverage.

Every command has a five-minute ceiling and emits start/finish progress. Keep snapshot, HOME, DATA_DIR, npm cache and reports private. The child environment uses an allowlist, excluding publisher/provider credentials, real-provider opt-ins and loader injection. Reuse pooled dependencies only after lockfile, Node 20.20.2 ABI and platform checks; never install through shared symlinks. Failed commands, empty executed test collections, stale reports/receipts, missing mandatory selectors and SHA drift fail closed. Missing ownership-correct unprivileged execution blocks bootstrap; never weaken trusted-shell predicates, skip security tests, use root/sudo or escape permission boundaries.

The full-mode test stage may use four sequential, independently supervised Vitest commands instead of one monolithic `test:ci` command. Each command retains the five-minute ceiling, at most four fork workers and per-file isolation. The union must equal the complete eligible tracked head inventory and configured discovery; reject missing, duplicate, unexpected, stale, failed or runtime-error results. Require an empty failure baseline and aggregate fresh JSON/JUnit only after all batches pass. Gate/policy changes still require full mode, independent review and a newly frozen runner plus imported helpers before use; the candidate cannot approve itself. This command-boundary amendment does not authorize scoped bootstrap, test omission, increased concurrency or timeout relaxation.
