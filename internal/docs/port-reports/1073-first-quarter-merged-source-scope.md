# #1073: February–April 2026 OmniRoute merged-source scope

Reviewed 2026-11-20. This is a read-only historical source-scope review for #1073. It records metadata coverage, a bounded set of source-diff comparisons, and only conclusions supported by changed lines and local static behavior.

## Search window and method

The requested upstream query was `repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-02-01..2026-04-30`. GitHub search reported **738** merged PRs. Independently bounded calendar-month slices returned:

| Merged date slice | PR count |
| --- | ---: |
| 2026-02-01..2026-02-28 | 111 |
| 2026-03-01..2026-03-31 | 287 |
| 2026-04-01..2026-04-30 | 340 |
| **Total** | **738** |

The search result pages were collected in eight pages (100 per page, last page 38). Full result and selected PR-detail JSON were kept under `/tmp`, not in the repository. PR source head SHAs and changed paths below came from the upstream PR metadata and file diffs. Titles were used only to find candidates for manual diff review; they are not evidence of behavior or applicability.

Local conclusions below use current source and tests as static evidence. A fork PR or commit is not treated as an upstream port unless its actual source identity maps to the upstream record. This review made no local code changes, ran no live provider or network tests, and does not claim exhaustive review of all 738 diffs.

## Concrete comparisons

| Upstream PR and pinned source head | Changed source | Local evidence and disposition |
| --- | --- | --- |
| [#188](https://github.com/cheaper-inference/OmniRoute/pull/188), `9ca890da7bf39c38acd66e48ed46c8e128438f06` | `open-sse/utils/stream.ts` | The upstream change separates Responses SSE from Chat Completions chunk sanitization. Local `open-sse/utils/stream.js` selects a Responses-specific summary path from the selected format (`isResponses` at lines 242–245; event handling at 309–331). This confirms format-aware handling in local stream processing. It does **not** establish that every raw passthrough path preserves Responses event bytes exactly as this upstream patch intended; exact raw-passthrough equivalence remains unverified. |
| [#193](https://github.com/cheaper-inference/OmniRoute/pull/193), `47ddb2890cb83bd8f96dff52bc55663e2c48af18` | `open-sse/translator/helpers/claudeHelper.ts`; `open-sse/translator/request/openai-to-claude.ts` | Upstream removes assistant `tool_use` blocks with missing/blank names and skips nameless OpenAI tool calls before sending Claude requests. In local `open-sse/translator/formats/claude.js`, `prepareClaudeRequest` normalizes message content and repairs tool ordering but does not visibly filter blank-name `tool_use` blocks (lines 729–755); local `open-sse/translator/request/openai-to-claude.js` constructs function tools and tool-use blocks without the corresponding blank-name guard. **Applicable residual.** Acceptance: for Claude-format destinations, drop assistant history `tool_use` blocks whose `name` is absent, non-string, or whitespace-only before ordering repair; when converting OpenAI calls, omit malformed calls with absent/non-string/blank function names before constructing Claude `tool_use`; preserve valid calls and matching tool results; add focused offline request tests for native history and translated calls, including whitespace-only names. |
| [#1462](https://github.com/cheaper-inference/OmniRoute/pull/1462), `763d353f5c520eb5f048ded69f903c8632e56b11` | `src/lib/db/encryption.ts`; `tests/unit/db-encryption.test.ts` | Upstream changes decryption failure from returning ciphertext to returning `null`, to prevent encrypted credentials from reaching providers. This fork uses a different column-crypto contract: `src/lib/crypto/columnCrypto.js` throws on malformed, unsupported, tampered, or wrong-key values, and `src/lib/db/index.js` decrypts encrypted credential fields through `decryptField`. The local contract does not return ciphertext as a plaintext credential. This is a behaviorally safer failure shape, but caller-level provider non-dispatch on every decryption failure was not traced end-to-end in this bounded review; no gap is asserted. |
| [#1794](https://github.com/cheaper-inference/OmniRoute/pull/1794), `8a807309499b3f6d3415049bcca9036c96b95106` | `open-sse/services/antigravityHeaderScrub.ts`; `tests/unit/executor-antigravity.test.ts` | Upstream strips all `x-omniroute-*` headers before Antigravity dispatch. Local `open-sse/executors/antigravity.js:238–244` constructs a closed header object containing only content type, bearer authorization, and a configured/default user agent; it does not forward caller headers at this dispatch seam. This is concrete local prevention of forwarding arbitrary internal headers on this path. Other Antigravity transport paths were not exhaustively traced. |
| [#635](https://github.com/cheaper-inference/OmniRoute/pull/635), `e3f016e26237c5844a2a6b1a248d5f371582c896` | `package-lock.json` (`yaml` 2.8.2 → 2.8.3); `open-sse/handlers/responseSanitizer.ts` | The source diff includes a dependency version change but does not, by itself, establish the advisory, affected range, or required fixed release. The local `pnpm-lock.yaml` records `yaml@2.9.0` and `js-yaml@4.3.2`, but no advisory-to-local-package/patch mapping was verified here. **Keep dependency-security scope unresolved** until the relevant advisory and local dependency path are pinned and the fixed-version condition is checked. The response-usage field mapping in this PR is a separate protocol behavior and is not credited as a dependency-security fix. |

## Explicit exclusions and unresolved inventory

- The selected PR detail set also included [#259](https://github.com/cheaper-inference/OmniRoute/pull/259), source head `74a058568314b65db06df2df5c844861403ae1ff`. Its diff mixes the new Ollama Cloud provider with database-backup and OAuth auto-import guards and OAuth identity comparisons. New provider work and sign-in/auth-flow work are excluded by this work order; this mixed PR is not credited as a single applicable port. Its individual backup-route security behavior was not separately reconciled against local route policy.
- New providers, features, endpoints, integrations, and sign-in/auth-flow changes are outside this report's applicability scope, even when they appear in the search inventory.
- **Unverified remainder:** all other members of the 738-PR window, including unselected security, provider, and protocol candidates, were not individually compared by changed path and source SHA. The counts establish inventory coverage only, not disposition or port coverage. No backlog total or coverage percentage is inferred.
- A local source similarity or a fork PR is not proof of upstream identity. No owner selection list is produced.

## Reproduction evidence

```sh
# Requested complete window: search total 738
gh api -X GET search/issues -f 'q=repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-02-01..2026-04-30' -f per_page=1 --jq .total_count

# Bounded date slices: 111 + 287 + 340 = 738
gh api -X GET search/issues -f 'q=repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-02-01..2026-02-28' -f per_page=1 --jq .total_count
gh api -X GET search/issues -f 'q=repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-03-01..2026-03-31' -f per_page=1 --jq .total_count
gh api -X GET search/issues -f 'q=repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-04-01..2026-04-30' -f per_page=1 --jq .total_count

# Local static anchors
rg -n 'const isResponses =|if \(isResponses\)|response\.output_item\.added' open-sse/utils/stream.js
rg -n 'Pass 1: remove cache_control|tool_use/tool_result ordering' open-sse/translator/formats/claude.js
rg -n 'buildHeaders\(credentials|Content-Type|Authorization|User-Agent' open-sse/executors/antigravity.js
rg -n 'yaml@2\.9\.0|js-yaml@4\.3\.2' pnpm-lock.yaml
```
