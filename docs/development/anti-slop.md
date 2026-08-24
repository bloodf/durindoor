# Anti-slop (oxlint) gate

DurinDoor vendors [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop)
at `tools/oxlint/anti-slop/` and runs it through **oxlint** as a required lint
process. The plugin is not an npm dependency.

## Local commands

```bash
# Full lint gate used by CI (eslint + anti-slop)
npm run lint

# Anti-slop only
npm run lint:anti-slop
```

Husky `pre-commit` runs `npm run lint:anti-slop` (required; not fail-open).

## What is enforced

- Dev dependencies: `oxlint` and `@oxlint/plugins` (pinned to the versions
  anti-slop was vendored against).
- Config: `.oxlintrc.json` registers the vendored plugin and sets every
  **generic** anti-slop rule to `"error"`.
- Effect rules are **not** enabled (this repository does not use Effect).
- Agent-tooling directories from the upstream README are ignored, plus `.omc/`.

## Why a baseline

Turning every generic rule on across `src/`, `open-sse/`, `tests/`, and
`scripts/` currently yields thousands of pre-existing hits (mostly
`anti-slop/no-runtime-typeof` in plain JavaScript). Rather than rewrite the
gateway in one PR, the required gate compares current diagnostics to
`tools/oxlint/anti-slop-baseline.tsv` (`file`, `rule`, `count`).

- **CI / husky fail** when a file/rule count increases or a new file/rule pair
  appears.
- **Decreases are allowed** (fixing debt). After a real cleanup, refresh the
  baseline:

```bash
node scripts/check-anti-slop.mjs --update-baseline
```

Do not grow the baseline without an explicit review. Growing it is the same
class of regression as adding to `tests/__baseline__/known-fails.txt`.

## `no-shape-in-symbol-names`

The rule bans any identifier whose name contains `"shape"` (case-insensitive).
Prefer domain-role names such as `layout`, `payload`, or `form`.

Known renames in this repo:

- Schema verifiers: `verifyPublishedSchemaLayouts`,
  `verifyApiKeyExpiryColumnLayout`, `verifyQuotaStorageLayouts`
- RTK hit labels and SQL column DDL fragments: parameter/property `layout`
- TTS voice mapping flag: `useElevenLayout`

External APIs that literally expose `.shape` (notably `PropTypes.shape`) cannot
be renamed. Call them with bracket access (`PropTypes['shape']`) so the banned
substring is not an Identifier. Do not disable the rule.

## Vendoring

See `tools/oxlint/anti-slop/VENDOR.md` for the upstream SHA and refresh steps.

Node loads the TypeScript plugin via `--experimental-strip-types` (Node
`20.20.2` / CI pin). The check script sets `NODE_OPTIONS` for you.
