# Contributor contract

This file is the contract for people changing DurinDoor, a fork of `decolua/9router`. Read it before you edit routing or tests.

## Repo map

- `src/`: Next.js dashboard and the `/v1` gateway.
- `open-sse/`: provider routing, translation, and executors.
- `cli/`: npm launcher published as `durindoor`.
- `website/`: public site plus a mocked dashboard demo.
- `docs/`: user and operator Markdown.
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

`npm run lint` and `cd tests && npm run test:ci` need to be green, or the PR waits. The body lists scope, tests, docs, and baseline impact. One branch per PR. Force-push only on that branch.
