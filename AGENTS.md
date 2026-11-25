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

Do not hand-edit `open-sse/providers/registry/index.js` or `open-sse/AGENT-INDEX.md`. Run `pnpm run gen:registry-index` and `pnpm run gen:agent-index` instead. Do not add lines to `tests/__baseline__/known-fails.txt`. Do not rewrite stored API key secrets. Do not push to `main`. Leave `~/.9router` and `~/.9router-backup-*.tar` alone.

## Translator conventions

`open-sse/translator/` pivots through OpenAI. Requests go source to OpenAI to target. Response chunks go the other way. Matching source and target skip translation.

- Fragile pairs need a direct route such as `claude:kiro`. The OpenAI hop drops thinking blocks, tool ids, non-base64 images, and `tool_result.is_error`.
- New translator files only run after they are imported in `open-sse/translator/index.js`, which is what fires `register(from, to, requestFn, responseFn)`.
- Tests that call `translateRequest` or `translateResponse` must `import "./registerAll.js"` at the top of the file.
- Role, block, and model strings come from `open-sse/translator/schema/` and `open-sse/config/`. Do not hardcode them.
- `open-sse/rtk/` compresses `tool_result` bodies in place and fails open: on error it returns null and leaves the body untouched. It skips `is_error` and `status:"error"` results.
- RTK normally runs on the translated (target-format) body in `chatCore.js`, after `translateRequest`. Cursor is the one exception: its translator (`translator/request/openai-to-cursor.js`) rewrites `role:"tool"` / Claude `tool_result` blocks into plain `<tool_result>` user text, so a post-translate pass has no tool-result shape left to compress. `chatCore.js` runs RTK on the source-format body for `provider === "cursor"` before that rewrite, and skips the post-translate call for that request so the body is never compressed twice.

## Test workflow

Run `sh scripts/checks.sh unit` for checks selected from changes against `origin/main`, or set `ORQ_CHANGED_FILES` to a file containing changed paths. Run `sh scripts/checks.sh final` for root lint and the complete CI test suite.

Install root, CLI (`cli/`), and test (`tests/`) dependencies before collecting the suite. The root/CLI advisory compatibility tests load the real CLI-only `nodemon` dependency. Pass `--config tests/vitest.config.js` unless you already run from `tests/` (Vitest picks that config up on its own).

```bash
pnpm install --frozen-lockfile
pnpm -C cli install --frozen-lockfile
pnpm -C tests install --frozen-lockfile
cd tests && pnpm run test:ci
```

That command is the CI gate. It discovers the configured inventory, checks it against the tracked test files, and runs it as twelve sequential Vitest batches with four isolated fork workers each. Each command has its own five-minute ceiling. It merges the batch reports into one Vitest JSON report and feeds it to `tests/__baseline__/verify-no-regression.mjs`. `tests/__baseline__/known-fails.txt` is empty in this tree, so every failing assertion is a regression. Do not add entries.

Offline translator tests need no credentials. `tests/translator/real/` runs only with `RUN_REAL=1` and requires `DATA_DIR` to point to a disposable copy of the data directory. Never point real tests at `~/.9router`; account and quota errors are skipped, while protocol failures are not.

Bugs that still exist in the app use `it.fails(...)` in `tests/translator/bugs-*.test.js`. After a fix, switch that row to `it` and run the file.

## PR checklist

Target `bloodf/durindoor:main`. Do not send PRs to `decolua/9router:dev` from this fork.

`npx commitlint --from=origin/main --to=HEAD` must exit 0. The PR title must also pass `echo "<title>" | npx commitlint`, because squash-merge uses the title as the commit subject.

PRs require root lint and independently reviewed scoped checks, or a full checkpoint when the risk floor requires it. The body lists scope, exact base/head, tests, docs, and baseline impact. One branch per PR. Never force-push without explicit authorization.

## Local gate authority

`scripts/local-ci.mjs` defaults to `--mode full`: lint and build, the conditional website build, the complete test inventory, reports and commitlint. A PR merges when two things are true:

1. A full local CI run passes on the exact PR head, started by the orchestrator or a review worker from a clean checkout of `main`, not from the candidate's own runner.
2. A reviewer from a different model family than the author has reviewed the diff and recorded its verdict on the PR.

No human-held receipt, frozen runner bundle, SHA256 manifest or owner-posted status is required. The repository owner can still review any PR, and GitHub-hosted checks, where configured, still apply.

Scoped mode (`--mode scoped`) is allowed for docs-only changes under `docs/` or `internal/docs/`. Everything else runs in full mode: code, tests, dependencies, toolchain, auth, crypto, money, DB, registry and gate changes.

Run focused tests directly from `tests/` with `node node_modules/vitest/vitest.mjs run <explicit-files> --maxWorkers=2`. Root runs need `--config tests/vitest.config.js`. Don't pass selectors to `pnpm -C tests run test:ci`: its wrapper doesn't forward them.

Every command has a five-minute ceiling. Keep HOME, DATA_DIR, caches and reports private to the run, and keep publisher and provider credentials out of the child environment. Failed commands, empty test collections, a non-empty failure baseline and SHA drift fail the run. Never skip security tests or use root or sudo.

The full-mode test stage may use twelve sequential Vitest commands, at most four fork workers each, with per-file isolation. Together they must cover the complete tracked test inventory.

Manual Actions remain fallbacks. Release, tag, nightly and publishing stay separate controls. Docker validation runs on a disposable builder; candidate subprocesses never get Docker control or publisher credentials. See `internal/docs/local-ci.md` for job coverage.

## Agent tooling

Read [the tooling guide](internal/docs/ai-tooling.md) before repository work.
