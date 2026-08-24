# Anti-slop (oxlint) gate

DurinDoor vendors [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop)
at `tools/oxlint/anti-slop/` and runs it through **oxlint** as a required lint
process. The plugin is not an npm dependency. The tree must stay clean: any
anti-slop diagnostic fails CI and the Husky pre-commit hook.

## Local commands

```bash
# Full lint gate used by CI (eslint + anti-slop)
npm run lint

# Anti-slop only
npm run lint:anti-slop
```

Husky `pre-commit` runs `lint-staged` (eslint on staged `src/**` files; fail-open
via `|| true`) and then `npm run lint:anti-slop` (required; not fail-open).

## What is enforced

- Dev dependencies: `oxlint` and `@oxlint/plugins` (pinned to the versions
  anti-slop was vendored against).
- Config: `.oxlintrc.json` registers the vendored plugin and sets every
  **generic** anti-slop rule to `"error"`.
- Effect rules are **not** enabled (this repository does not use Effect).
- Agent-tooling directories from the upstream README are ignored, plus `.omc/`.
- Vitest / Jest test files (`tests/**`, `**/*.{test,spec}.*`) are ignored so
  the gate covers production sources without forcing a test-architecture rewrite
  of endemic `vi.mock` usage. Production code (including `src/`, `open-sse/`,
  `cli/`, `scripts/`, and entrypoints) must report **zero** diagnostics.

## Runtime type checks

Production code must not use the `typeof` operator. Use
`src/shared/utils/typeChecks.js` (and the `.cjs` mirror for CJS entrypoints):

- `isString` / `isNumber` / `isBoolean` / `isFunction` / `isObject` /
  `isUndefined` / `isSymbol` / `isBigInt` / `isBrowser` / `runtimeTypeName`

These helpers match ECMAScript `typeof` tag semantics without using `typeof`.

## `no-shape-in-symbol-names`

Do not put the substring `shape` in identifier names. Prefer domain names
(`layout`, `payload`, `form`, …). For PropTypes, call the external API via
bracket access (`PropTypes["shape"](...)`) so the identifier is not named
`shape`.

## Vendoring

See [`tools/oxlint/anti-slop/VENDOR.md`](../../tools/oxlint/anti-slop/VENDOR.md) for the upstream SHA and refresh steps.

Node loads the bundled JavaScript plugin at
`tools/oxlint/anti-slop/index.bundle.js`. Rebuild it after refreshing the
vendored TypeScript sources:

```bash
node scripts/build-anti-slop-plugin.mjs
```
