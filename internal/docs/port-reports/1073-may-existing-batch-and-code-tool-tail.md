# #1073 May existing batch and Codex tool tail

Reviewed against the local DurinDoor source and offline fixtures. The public
refs below identify the exact requested heads and their enclosing integrations;
the PR commits are used for the scoped patch review where an integration also
contains unrelated release changes.

## Exact pins

| OmniRoute PR | Exact public PR head | Enclosing integration | Reviewed scoped change |
| --- | --- | --- | --- |
| [#2045](https://github.com/cheaper-inference/OmniRoute/pull/2045) | [`d8302a17a0eb65923efb9c760c60ac1072d252b3`](https://github.com/cheaper-inference/OmniRoute/commit/d8302a17a0eb65923efb9c760c60ac1072d252b3) | [`a47bb903888f1f21706a8b850c0f4010e0f70c03`](https://github.com/cheaper-inference/OmniRoute/commit/a47bb903888f1f21706a8b850c0f4010e0f70c03) | `batchProcessor.ts` fallback from JSON decode to text for successful per-item responses |
| [#2634](https://github.com/cheaper-inference/OmniRoute/pull/2634) | [`c8c67528d645f7b2d822a42b5cf87bd51e5998d4`](https://github.com/cheaper-inference/OmniRoute/commit/c8c67528d645f7b2d822a42b5cf87bd51e5998d4) | [`259b0cc835f7d86e0805792e020525b4b16d091d`](https://github.com/cheaper-inference/OmniRoute/commit/259b0cc835f7d86e0805792e020525b4b16d091d) | Provider batch retry-duration and exponential-backoff settings |
| [#2940](https://github.com/cheaper-inference/OmniRoute/pull/2940) | [`7ffc56b7e0f296b2f8ef164b269c12b5e7070d0d`](https://github.com/cheaper-inference/OmniRoute/commit/7ffc56b7e0f296b2f8ef164b269c12b5e7070d0d) | [`2b613d9fb8ccd72cc6434d3fed88bdeba8016aba`](https://github.com/cheaper-inference/OmniRoute/commit/2b613d9fb8ccd72cc6434d3fed88bdeba8016aba) | Combo vision-bridge mapping decision and Codex missing function-call output repair |

The #2634 enclosing commit is a broad merge of a release branch. Its scoped
batch change is the addition of `BATCH_RETRY_DURATION_MS`,
`BATCH_BACKOFF_BASE_MS`, and `BATCH_BACKOFF_MAX_MS` to the separate upstream
provider-batch worker; unrelated release and docs changes are outside this
review. #2940 is a three-file patch: Codex history normalization, vision-bridge
combo mapping behavior, and the corresponding Codex unit fixture.

## Local behavior and fixture evidence

### Batch results and retry policy

DurinDoor exposes local `/v1/files` and `/v1/batches` through
[`localFilesBatches.js`](../../../open-sse/services/localFilesBatches.js).
The batch worker invokes the injected gateway executor and records its
`status_code` and already-decoded `body`; errors are recorded as failed rows.
It does not consume raw Fetch `Response` objects, use OmniRoute's durable
provider-batch queue, or maintain a batch-specific transient-retry loop. File
and batch owner IDs remain attached to resources and result files, with
owner-filtered lookup and mutation. These ownership and response fields must
not change as a side effect of adopting upstream worker behavior.

The existing offline fixture
[`v1-batches.test.js`](../../../tests/unit/v1-batches.test.js) covers the
local upload/create/poll/result contract, successful rows, non-2xx results,
thrown executor failures, cancellation, and owner isolation. In particular,
success output preserves `{status_code, request_id, body}` and failure counts
remain distinct. It does not demonstrate a raw non-JSON Fetch response because
that is not the local executor contract.

The local gateway separately has shared request preflight and model-limit
resolution, retry rules in the executor/request pipeline, and quota reset
handling. Existing offline evidence includes
[`live-limits-runtime.test.js`](../../../tests/unit/live-limits-runtime.test.js),
[`model-metadata-resolution.test.js`](../../../tests/unit/model-metadata-resolution.test.js),
[`base-executor-skip-rules.test.js`](../../../tests/unit/base-executor-skip-rules.test.js),
and [`combo-retry-after-port.test.js`](../../../tests/unit/combo-retry-after-port.test.js).
Those are gateway behavior; they do not establish durable provider-batch
retry semantics or authorize applying gateway retries a second time inside the
local batch worker.

### Responses tool history and combo vision

The local Codex executor normalizes assistant history and sanitizes native
Responses items. The translator matches calls and outputs by call ID, handles
orphan outputs, and preserves tool-result media through its ordinary format
bridges. Fixture evidence includes
[`codex-assistant-history-normalization.test.js`](../../../tests/unit/codex-assistant-history-normalization.test.js),
[`bugs-codexCli-responses.test.js`](../../../tests/translator/bugs-codexCli-responses.test.js),
[`responses-history-tool-identity-15974.test.js`](../../../tests/unit/responses-history-tool-identity-15974.test.js),
and [`openai-responses-tool-output-images.test.js`](../../../tests/translator/openai-responses-tool-output-images.test.js).
These cover valid paired tool history, native item validation, historical
namespace identity, and image-bearing tool outputs. They do not fabricate
results for an unfinished call.

The #2940 Codex helper inserts an empty `function_call_output` after each
historical function call without a matching output. That changes the client's
history semantics and invents a tool result. DurinDoor has no matching repair
rule; its native Codex path and translator retain their own validation and
pairing behavior. The patch is not evidence that every missing result should
be synthesized.

Combo capabilities are derived from existing members and bounded by configured
caps. `vision` aggregation and custom target capability handling are covered
by [`combo-capability-ceiling.test.js`](../../../tests/unit/combo-capability-ceiling.test.js),
[`custom-caps-combo-vision.test.js`](../../../tests/unit/custom-caps-combo-vision.test.js),
and [`vision-bridge.test.js`](../../../tests/unit/vision-bridge.test.js).
The upstream `VisionBridgeGuardrail` mapping model is not the local combo
execution seam. The ordinary local bridge reroutes only when a configured,
vision-capable target is available; combo capability and media execution are
resolved through their existing local paths. No absent mapping or opt-in
integration is inferred from the upstream code.

## Dispositions

| PR | Disposition | Basis |
| --- | --- | --- |
| #2045 | **Not applicable to the local batch contract** | Its scoped change handles raw Fetch response decoding in OmniRoute's provider batch worker. DurinDoor's local worker receives decoded executor objects, and its fixture contract is already exercised offline. No demonstrated local gap justifies changing batch response fields or ownership. |
| #2634 | **Defer; no local equivalent source mode** | Configurable retry duration and backoff apply to OmniRoute's durable provider batch retries. DurinDoor's local batch worker is in-process and currently records each gateway executor outcome once. Gateway model caps, quotas, and retry policy already exist independently. Adding batch retry knobs would introduce a new source mode and could alter duplicate execution/accounting semantics. |
| #2940 | **Do not port** | The vision mapping logic targets an upstream bridge/mapping seam absent locally, while local combo capability/media behavior has direct fixtures. The Codex change fabricates empty tool outputs; ordinary native history fixtures preserve matched results and the translator handles pairing explicitly. No demonstrated narrow compatibility gap supports synthesizing history. |

No narrow functional gap is demonstrated by these exact patches, so no product
change or new acceptance fixture is proposed. If a future ordinary offline
fixture demonstrates a local need, acceptance should stay at the applicable
boundary: (1) exercise a local batch executor result/error while preserving its
current response shape, ownership, request counts, and one-attempt accounting;
(2) exercise a real native Responses continuation with call IDs and outputs,
preserving supplied history and never inventing tool output; or (3) exercise a
combo with explicit member capabilities, retaining the aggregate ceiling and
current media/routing decision. Tests must use injected executors and static
fixtures only, with no provider traffic or opt-in integration.
