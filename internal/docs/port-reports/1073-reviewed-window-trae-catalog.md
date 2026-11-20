# #1073 — reviewed-window Trae and catalog dispositions

Reviewed 2026-11-20 against the current DurinDoor worktree. This is a static defensive comparison of the two requested OmniRoute merges and the model-catalog visibility row in §6 of [1073 historical path coverage](1073-historical-path-coverage.md). No product code was changed, no vulnerability was reproduced, and no provider or credential was used.

## #15686 — Trae stream proxy-health attribution

- Upstream PR: [OmniRoute #15686](https://github.com/cheaper-inference/OmniRoute/pull/15686)
- Source merge: [`77bca6f878180006f3a679b53400d55a344fcd83`](https://github.com/cheaper-inference/OmniRoute/commit/77bca6f878180006f3a679b53400d55a344fcd83), the 2026-10-06 squash recorded in §8 of the historical coverage note.
- Disposition: **upstream health-sink defect not confirmed reachable through the ordinary DurinDoor Trae path; generic local stream error remains possible.**

The historical coverage note identifies this upstream change as a proxy-health status-sink change and correctly marks its Trae path not covered line-for-line. In DurinDoor, [`TraeExecutor.streamEvents`](../../../open-sse/executors/trae.js) fetches the events stream and checks `response.ok` and `response.body`. It does not send `upstreamStatus` to the proxy-health sink. The ordinary chat route calls the executor via [`chatCore.js`](../../../open-sse/handlers/chatCore.js); the executor's returned `Response` status is gateway-facing. A failed event response is converted into a thrown error and the executor's stream wrapper reports a local error response. It is not attributed as an upstream HTTP status through that sink.

Therefore the particular upstream defect—incorrect proxy-health attribution from a missing/incorrect upstream status value—cannot be established for the current Trae call path: the required upstream-status attribution is absent. This is distinct from a generic local no-body condition: if a fetch returns an otherwise-OK response with no body, `!response.body` still throws `[${response.status}] events stream failed` (often status 200 in the message), and the wrapper surfaces a local stream failure. That behavior can fail a request, but it is not proof that the upstream proxy-health status sink misattributes a gateway health result.

Durable local evidence: [`open-sse/executors/trae.js`](../../../open-sse/executors/trae.js), [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js), and the existing offline Trae exercise in [`tests/unit/oauth-blocked-providers.test.js`](../../../tests/unit/oauth-blocked-providers.test.js) (Trae session/event mapping). That fixture exercises successful synthetic SSE; it does not assert proxy-health status attribution or a no-body response. No missing qualifying behavior is confirmed. If a follow-up is warranted, ordinary offline fixtures can stub the event fetch with a non-2xx response and with an OK response lacking a body, then assert gateway response behavior and that no upstream status is reported to the proxy-health sink.

## #15643 — quota tracker registration

- Upstream PR: [OmniRoute #15643](https://github.com/cheaper-inference/OmniRoute/pull/15643)
- Source merge: [`ebf312019`](https://github.com/cheaper-inference/OmniRoute/commit/ebf312019), recorded in §6.1 of the historical coverage note.
- Disposition: **already covered / no missing behavior.**

The source change removes an import from upstream `src/sse/handlers/chat.ts`; the import is already absent from local [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js). The historical path coverage review compared the changed lines and found the removal fully reflected locally. This is a source-level comparison; no test change is indicated by the one-line import removal.

## §6 model-catalog key visibility row (#15452)

- Upstream PR: [OmniRoute #15452](https://github.com/cheaper-inference/OmniRoute/pull/15452)
- Source merge: [`6fc43757f`](https://github.com/cheaper-inference/OmniRoute/commit/6fc43757f), as recorded in §6.2 of the historical coverage note.
- Disposition: **structurally absent upstream defect / no missing behavior identified.**

Upstream's `catalogKeyFilter` stopped using a catalog row's `root` field to prevent namespaced roots from re-admitting rows belonging to another provider. DurinDoor's ordinary `/v1/models` path is [`route.js`](../../../src/app/api/v1/models/route.js) → [`modelAccess.js`](../../../src/sse/services/modelAccess.js) over the list assembled by [`buildModelsList.js`](../../../src/app/api/v1/models/buildModelsList.js). The access filter derives candidate ids from `entry.id`, provider aliases, and provider-node prefixes. The local catalog entries do not carry `root`, and `buildModelsList` does not emit it; the implicated visibility input therefore cannot occur on this path.

The existing offline [`api-key-model-access.test.js`](../../../tests/unit/api-key-model-access.test.js) checks per-key allow/deny filtering of `/v1/models` entries and anonymous behavior. It does not reproduce the upstream root-field case, which the local shape excludes. No qualifying missing behavior is confirmed, and no vulnerability reproduction is needed.

## Evidence boundary

The historical coverage note is the source for the window classification and pinned merge ids: [`1073-historical-path-coverage.md`](1073-historical-path-coverage.md), especially §§6.1, 6.2 and 8. This note records static source and existing fixture evidence only. No product code or tests were added.
