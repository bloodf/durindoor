# Azure and Codex request compatibility (#1072)

Compared 2026-11-20 against local base `8ccddc4bd39b2d36958053cf0c142a5a0e4742c3` and upstream `master` `1855aa44473e88feac9d3f131b9c0c5fc9706b68`. Both sources were open and unmerged at the observed heads, and upstream `master` carries neither behavior (no `GPT5_FAMILY_DEPLOYMENT`-style rule in `open-sse/executors/azure.js`, no foreign-reasoning drop in `open-sse/executors/codex.js`), so neither is a closed-unmerged port. No provider, browser, media, or live-account request was made: every statement below comes from the final PR diffs, this repository's code, and offline fixtures.

- [#2809](https://github.com/decolua/9router/pull/2809), head `1e0887bb84afd6bf994c5109055bb29a6532e1dc`: **adapted**. Upstream normalizes Azure GPT-5/GPT-6 and o-series chat-completion parameters. The fork ports the parameter normalization, gated on local deployment evidence instead of upstream's model-first deployment resolution, and excludes the unrelated Cloudflare, installer, and release-package changes.
- [#5141](https://github.com/decolua/9router/pull/5141), head `78127501f43fe96eeb2a0ba265ba1db0f1cca41a`: **partially adapted; one source commit not ported**. Upstream's first commit (drop reasoning another provider sealed) is ported on local format evidence only. Its second commit (decide from the ciphertext blob) is not ported: it reads opaque token bytes and would discard reasoning whose provenance this fork cannot establish.

## #2809 — Azure GPT-5 chat completion parameters

Source behavior at the final head (`open-sse/executors/azure.js`): for a deployment whose name matches `/(?:^|[/_-])(?:gpt-(?:5|6)|o(?:1|3|4))(?:[._-]|$)/i`, send `max_completion_tokens` instead of `max_tokens`, drop a `temperature` that is not `1`, and drop `reasoning_effort` when tools are present. Upstream's `resolveDeployment` prefers the requested model over the connection's configured deployment, and `buildUrl` percent-encodes the deployment and API version.

Local contract before the port: `AzureExecutor.transformRequest` applied the fork's model-driven token-cap rename (`applyParamRenames`, OmniRoute #6912/#6964) and negotiated the token-cap spelling against a measured 400 `unsupported_parameter` (`azure-token-limit-5487.test.js`). No temperature or `reasoning_effort` rule existed for Azure, and `BaseExecutor.execute` deliberately never strips an Azure token-limit field (`open-sse/executors/base.js:448`).

Adaptation in `open-sse/executors/azure.js`:

- The family is read from the deployment identifier this executor actually calls (`resolveDeployment`: the connection's `providerSpecificData.deployment`, else the requested model, else `AZURE_DEPLOYMENT`, else `gpt-4`). Azure deployment names are operator-chosen and opaque, so an unrecognized name is left untouched instead of being guessed into a family. A deployment serving another family keeps the fork's existing model-driven rename, and the model-driven rename still applies to a GPT-5-family *model* on a deployment whose name does not identify the family.
- For a known family deployment the deployment decides the token-cap spelling: `max_tokens` becomes `max_completion_tokens` (an explicit `max_completion_tokens` wins), a `temperature` other than `1` is dropped, and `reasoning_effort` is dropped when tools are present. `tools` and `tool_choice` are preserved, and the caller's body is never mutated.
- The negotiated spelling still wins over the family default: the measured-retry preference is applied after the family rule, so an Azure deployment that rejects `max_completion_tokens` still gets exactly one retry with `max_tokens`, and that spelling is remembered per deployment URL.

Rejected alternatives:

- Upstream's model-first `resolveDeployment` would ignore the operator's configured deployment, call a different Azure deployment than the one configured, and collapse the per-deployment token-limit cache (the existing `azure-token-limit-5487.test.js` fixtures key on distinct deployments under one model id).
- Upstream's `encodeURIComponent` on the deployment and API version changes URL construction and the cache key. It is not request-parameter normalization and has no local contract, so it was left out.
- Upstream's first commit removed `reasoning_effort` whenever its value was `none`; the final head only removes it when tools are present. The fork follows the final head.

Excluded source changes (outside the request-compatibility scope, unrelated to Azure or Codex): the Cloudflare tunnel changes (`src/lib/tunnel/cloudflare/cloudflared.js`, `healthCheck.js`, `manager.js`, `tests/unit/tunnel-healthcheck.test.js`), the installer additions (`INSTALL-CUSTOM.md`, `scripts/update-from-origin.sh`), the release-package additions (`package.json` `allowScripts`, `scripts/copy-standalone-assets.mjs`), and the upstream `tests/unit/azure-executor.test.js` file, which is replaced by this fork's fixture below.

Tests: `tests/unit/azure-codex-request-compat-1072.test.js` (Azure block) covers an explicit deployment override, the requested model used as the deployment when the connection names none, another model family left untouched, a no-op when the deployment name does not establish the family, preserved tools and `tool_choice`, a non-mutated caller body, and the negotiated token-limit retry. `tests/unit/azure-token-limit-5487.test.js` is unchanged and still passes. Public behavior is documented in `docs/providers/api-key-providers.mdx`.

## #5141 — Codex replay of reasoning another provider sealed

Source behavior at the final head (`open-sse/executors/codex.js`): before the server-item-id strip, drop every `reasoning` item whose id is UUID-shaped (`rs_<uuid>`, Grok Build's format) — the first commit — and, in the second commit, also drop every reasoning item whose `encrypted_content` blob does not start with the OpenAI Fernet prefix `gAAAAA`. Rationale: Codex cannot decrypt another provider's blob and rejects the whole request with 400 `invalid_encrypted_content`, so a combo that fell back to Grok keeps falling back on every later turn.

Adaptation in `open-sse/executors/codex.js`:

- Ported: a `reasoning` item whose id matches the UUID-shaped pattern is dropped before the replayed item ids are normalized away. The pattern is the one this fork already uses for the opposite direction (`open-sse/executors/grok-cli.js:26`, OmniRoute #14650), so the local format evidence is established in-tree.
- Not ported: the blob check. Deciding from the ciphertext bytes would classify every reasoning item the fork cannot identify as foreign, including OpenAI-sealed items from another account and items of unknown provenance. The blob is opaque, so the fork never inspects it, never processes real ciphertext, and never guesses from token values.
- Preserved: reasoning whose provenance cannot be established locally (no id, or an id this fork does not recognize) stays in the request, as do summary-only reasoning items, messages, and tool calls. The existing one-shot 400 `invalid_encrypted_content` recovery (#2667) is unchanged and still owns a stale OpenAI-sealed blob: it strips the unverifiable blob and retries the same account once. Credential handling is untouched.

Tests: `tests/unit/azure-codex-request-compat-1072.test.js` (Codex block) covers the Grok-sealed item being dropped while OpenAI-sealed reasoning, messages and tool calls survive, reasoning of unknown provenance being preserved (id-less replay, unrecognized id, summary-only), and the one-shot `invalid_encrypted_content` recovery still retrying the same account once with the unverifiable blob removed. The fixture fails against the unmodified executors and passes against the ported ones.

## Verification

Offline fixture and the two neighboring suites it must not regress:

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/azure-codex-request-compat-1072.test.js \
  unit/azure-token-limit-5487.test.js \
  unit/codex-usage-credential-binding.test.js
```

20 tests pass (11 in the new fixture, 9 across the two existing files). Root lint (`npm run lint`) passes on the product changes. This is offline evidence only: no full-suite claim, no live-provider or credential-backed verification, and no change to the regression baseline.
