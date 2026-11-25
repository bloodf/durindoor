# #1073: late-May Codex and Antigravity execution comparison

## Method and pins

Compared each specified merge commit's first-parent patch in the local pinned OmniRoute object database at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` with the current DurinDoor executor and request/response path. The merge commits and first parents were verified with `git show -s --format='%H %P %s'`; each patch below is `merge^1..merge`. The PR head is recorded separately as the supplied review pin. Conclusions describe local code and fixtures, not live provider behavior.

| PR | Supplied head | Exact merge | First parent | Disposition |
|---|---|---|---|---|
| OmniRoute [#2537](https://github.com/cheaper-inference/OmniRoute/commit/c9e52397a56a28c98ca4ef7c3b825eaa41cce39b) | `b507526e42edcdd2a99d353be53cb573b59f5b55` | `c9e52397a56a28c98ca4ef7c3b825eaa41cce39b` | `d0133bc5b9f899347b53d872a0b594bf5b0de27c` | Already covered in shipped behavior; upstream's implementation is not a direct port candidate. |
| OmniRoute [#2579](https://github.com/cheaper-inference/OmniRoute/commit/8f0a4c1adeac71d47d227fcdcd2b90d424df040e) | `1491f46807c805d896cd7e7e526f01fefef56905` | `8f0a4c1adeac71d47d227fcdcd2b90d424df040e` | `436196c167a23c1dedcd8ae2fce7b0fb519675f8` | Incompatible with current local execution model; no remaining scoped fix identified. |
| OmniRoute [#2615](https://github.com/cheaper-inference/OmniRoute/commit/f52df7b8248f94999e2bb2b30a3aa5900b1e9914) | `22d9cf371771c3fe37fee30edd2ce031f37bd13d` | `f52df7b8248f94999e2bb2b30a3aa5900b1e9914` | `ebe0b6607cb6d9e4d06c9f2856347a51e7f40ad6` | Already substantially covered by local parameter filtering; patch-specific allowlist change is redundant for the examined contract. |

## #2537 — Antigravity pre-response timeout and failover

The exact first-parent patch adds a bounded fetch for Antigravity requests, tags only its own pre-header timeout, returns a gateway timeout with an upstream-timeout classification, and lets the account layer exclude that connection and try another one. It applies to the primary, retry-without-project-header, and credits-mode requests. This is a timeout before response headers; it does not change streaming after a response starts.

Current local behavior already covers that lifecycle through the shared executor transport. [base.js](../../../open-sse/executors/base.js) bounds fetch until headers arrive, proves timeout ownership from the merged abort reason, and marks Antigravity's own timeout with `antigravityPreResponseTimeout`. [chatCore.js](../../../open-sse/handlers/chatCore.js) preserves the signal and reports 504; [chat.js](../../../src/sse/handlers/chat.js) excludes the failed account and advances to another connection. Existing request/stream handling is independent once response headers arrive. This is a shared transport adaptation rather than a need to duplicate the PR's executor-local timer.

**Disposition:** already covered. No ready scoped fix from this patch.

## #2579 — Copilot configuration merge removing Codex response replay

The first-parent patch is predominantly deletion: it removes `responsesToolCallState`, response-stream recording of prior conversation/tool calls, and Codex request reconstruction using `previous_response_id`, including orphan tool-call recovery. The title mentions Copilot configuration, but these deletions alter Codex Responses request materialization and stream side effects. They cannot establish that the deleted replay was wrong for DurinDoor's runtime.

Current local Codex execution is stateless for this case: [codex.js](../../../open-sse/executors/codex.js) removes `previous_response_id` because local Codex connections use `store=false`, and there is no `responsesToolCallState` cache/import in the current stream path [stream.js](../../../open-sse/utils/stream.js). The local handler independently salvages orphan tool results before translation in [chatCore.js](../../../open-sse/handlers/chatCore.js), folding text into user content rather than dropping it. These semantics differ from OmniRoute's cached response replay and its synthetic recovery message. Importing the PR's removal would remove no local behavior; reintroducing replay would conflict with the local stateless request contract.

**Disposition:** incompatible change, already absent locally. No ready scoped fix from this patch.

## #2615 — Codex non-passthrough parameter allowlist

The first-parent patch replaces a denylist with an allowlist after Codex's native passthrough branch. Its intended effect is to discard unrecognized Chat Completions parameters such as `stop`, `response_format`, `logit_bias`, `functions`, and `parallel_tool_calls` rather than forwarding them to the Responses endpoint. The patch retains native passthrough and known Responses fields.

Current local [codex.js](../../../open-sse/executors/codex.js) also has a final allowlist, selected separately for compact and ordinary Responses requests. It drops unknown keys after normalization. The ordinary allowlist contains the supported request fields, while the executor explicitly removes unsupported sampling/token-limit fields and `previous_response_id` before filtering. Thus ordinary translated requests receive the same key-safety property. The local allowlist is broader in some supported native fields (`parallel_tool_calls`, `text`, `context_management`) and has local `store=false` semantics; copying the OmniRoute set verbatim would change the accepted native request shape without evidence that the endpoint behavior matches.

**Disposition:** behavior already covered, with a different locally evidenced contract. No ready scoped remaining fix. Do not backport the upstream allowlist verbatim.

## Demonstrated local behavior and limits

This audit used source inspection and existing unit-test fixtures only; it did not send provider traffic. Local executor tests demonstrate Codex request normalization and filtering in [codex-assistant-history-normalization.test.js](../../../tests/unit/codex-assistant-history-normalization.test.js), [codex-stateless-response-input.test.js](../../../tests/unit/codex-stateless-response-input.test.js), and [codex-tool-normalization.test.js](../../../tests/unit/codex-tool-normalization.test.js). Antigravity stream terminal and drain behavior is exercised with synthetic streams in [antigravity-terminal-without-eof-review.test.js](../../../tests/unit/antigravity-terminal-without-eof-review.test.js) and [antigravity-terminal-drain-bound.test.js](../../../tests/unit/antigravity-terminal-drain-bound.test.js). These fixtures support the local code-path claims; they do not prove behavior against real providers or establish equivalence of upstream and local services.

No product code or tests changed. No remaining fix in this comparison is ready for a scoped implementation based on the pinned patches and current local evidence.
