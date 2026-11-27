# Ledger A provider/connection port, rows 7–12

Result: **PARTIAL**. Four rows have a final scope disposition; #474 and #576 remain open. No runtime code, tests, settings, pricing, inventory hashes, or failure baseline changed.

Selection: rows 7–12 after filtering the [close ledger](1072-close-ledger-a.md) to `remaining` or `partial`, in table order. The older report is unchanged. Local code was inspected at `904bf0860b51568526d06a462c76838049ca126d`.

For each row, `gh api repos/decolua/9router/pulls/N` and `gh api repos/decolua/9router/pulls/N/files --paginate` fetched PR metadata and file patches. The upstream heads inspected are recorded below. No provider requests or credentials were used.

| Selected row | Upstream PR | Final status | Evidence and disposition |
| --- | --- | --- | --- |
| 7 | [#297](https://github.com/decolua/9router/pull/297) | not applicable: remaining manual-refresh feature; auth fixes already present | [CodexExecutor.refreshCredentials](../../../open-sse/executors/codex.js) delegates to the shared refresh lifecycle. [Codex refresh tests](../../../tests/unit/codex-refresh-token.test.js) cover token rotation, omitted refresh tokens, proxy routing and the executor lifecycle. [Kiro usage](../../../open-sse/services/usage/kiro.js) selects regional control-plane hosts. The remaining upstream manual-refresh endpoint is a new product feature, excluded by this work order. Local `src/app/api/oauth/refresh/route.js` is absent; adding the dashboard control and forced-refresh endpoint is not an existing-provider bug fix. |
| 8 | [#392](https://github.com/decolua/9router/pull/392) | not applicable: remaining synthetic tool-call bypass; initiator fix already present | [GitHub executor](../../../open-sse/executors/github.js) sets the initiator using the final turn and preserves messages in the transport context, verified by the [existing initiator tests](../../../tests/unit/port9r-copilot-initiator-392.test.js). The upstream `bypassAgentToolCalls` setting and branch are absent from local [bypassHandler](../../../open-sse/utils/bypassHandler.js) and the chat settings path. They add synthetic responses for tool continuations without user input. This is a new feature that would discard legitimate tool results, not a provider fix. |
| 9 | [#412](https://github.com/decolua/9router/pull/412) | out of scope: remaining gateway DB cache; provider compatibility fixes already present | [collapseTextParts](../../../open-sse/translator/concerns/message.js) normalizes text arrays; [parseSSELine](../../../open-sse/utils/streamHelpers.js) accepts bare JSON without misreading SSE data lines. [Normalization tests](../../../tests/unit/translator-request-normalization.test.js) verify text-only, multimodal, NDJSON and SSE behaviour. [Cursor local store](../../../src/lib/oauth/services/cursorLocalStore.js) has exact-key queries and fuzzy fallback; [path tests](../../../tests/unit/cursor-local-store-paths.test.js) cover Windows locations. The remaining `src/sse/services/requestContext.js` module is absent. Threading a settings/aliases/nodes/combo snapshot through gateway services is a separate cache optimization, outside provider/connection bug fixes. |
| 10 | [#474](https://github.com/decolua/9router/pull/474) | remaining | [Model resolution](../../../src/sse/services/model.js) resolves bare ids and aliases. Connection `defaultModel` is stored by the [provider update route](../../../src/app/api/providers/[id]/route.js), but it is not substituted by chat or embeddings. Upstream replaces every bare request model after selecting credentials, including concrete model ids. Locally, [chat resolution](../../../src/sse/handlers/chat/singleModel/resolveModel.js) rejects incompatible model kinds before account selection, and [embeddings](../../../src/sse/handlers/embeddings.js) resolves typed access before `runMediaAccounts`. A safe port must define when a bare alias requests a connection default, then apply access, capability, quota and accounting decisions to that effective model on every attempt. Copying the upstream substitution would bypass earlier decisions. |
| 11 | [#568](https://github.com/decolua/9router/pull/568) | out of scope: new proxy-management UI features | The local proxy-pool page `src/app/(dashboard)/dashboard/proxy-pools/page.js` already supports selection, bulk activation/deletion and health checks through per-item endpoints. Upstream adds search, sorting, additional filters and a new bulk API. Local `src/app/api/proxy-pools/bulk/route.js` is absent, and the page has no upstream `filteredAndSortedProxyPools` implementation. These are management product features, not provider/connection bug fixes. No UI or Storybook source changed. |
| 12 | [#576](https://github.com/decolua/9router/pull/576) | remaining | [pipeWithDisconnect](../../../open-sse/utils/streamHandler.js) already aborts first-byte stalls and clears its watchdogs; [first-chunk tests](../../../tests/unit/stream-first-chunk-timeout.test.js) pass. [Streaming handler](../../../open-sse/handlers/chatCore/streamingHandler.js) already shares its detail id across lifecycle writes. Upstream's configurable pre-response account fallback remains absent: no `raceTtftDeadline` in local [chatCore](../../../open-sse/handlers/chatCore.js), and no upstream `ttftTimeoutMs`/`ttftCooldownMs` settings passed by the gateway. Safe fallback must own/cancel the reader and deadline before exposing the response, preserve the first buffered bytes, and never retry after client output. Existing post-response watchdogs do not supply that contract. |

## Upstream revisions

- #297: `d6169bb8568775bccdd45a33b7ac351d46ab71e8`.
- #392: `3a597f067f9359180dab5cb1c2e3fde9a0755433`.
- #412: `71976748ece2fa57eb8b9aec7ecfcd61475e26c1`.
- #474: `2de02805c233fe2c67cd1809e8bba6407d2d29a9`.
- #568: `2efb0ca22a684f1dfc4e187993863837dc517707`.
- #576: `9a2226ed64d911a4755ae02ba3ed7ef8b7e714a4`.

## Validation and remaining work

Installed root, CLI and tests dependencies with their frozen lockfiles. Focused verification passed: **5 files, 29 tests**.

```sh
cd tests
DATA_DIR=$(mktemp -d) node node_modules/vitest/vitest.mjs run unit/codex-refresh-token.test.js unit/port9r-copilot-initiator-392.test.js unit/translator-request-normalization.test.js unit/cursor-local-store-paths.test.js unit/stream-first-chunk-timeout.test.js --maxWorkers=2
```

The first required check ran 4 files and 12 tests: three files passed and the docs graph check rejected an angle-wrapped dashboard link. The reference now uses an inline code path because this validator cannot parse parentheses in Markdown link targets. The complete four-file check was rerun after that correction; the final result was **4 files passed, 12 tests passed**. This report was staged before documentation validation so the tracked-file link validator includes it.

The two remaining behaviours together require more than approximately one hour for implementation and regression proof across the current gateway stages. Per the work-order cutoff, they remain explicit rather than receiving the unsafe upstream implementations. #474 needs tests for alias versus concrete ids, per-account defaults, denied effective models and endpoint kinds. #576 needs tests for account fallback before output, cancellation/disconnect, buffered first bytes, no fallback after output, and declared settings. No new behaviour was ported, so there are no per-behaviour port commits or changed test expectations. No full local CI or independent review is claimed.

Required check command:

```sh
cd tests
DATA_DIR=$(mktemp -d) node node_modules/vitest/vitest.mjs run unit/review-l-docs.test.js unit/1300-v5-storybook-inventory.test.js unit/model-catalog-consistency.test.js unit/review-r-settings-complete.test.js --maxWorkers=2
```
