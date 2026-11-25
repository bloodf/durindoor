# #1073 — May existing routing and stream tail review

## Scope and pins

This review compares the public PR-specific patches, rather than treating the enclosing release merges as single changes:

| PR | Exact PR head | Enclosing merge | Public patch |
|---|---|---|---|
| [OmniRoute #2458](https://github.com/cheaper-inference/OmniRoute/pull/2458) | `6ee3533a1223e79b6622e91188cf4c2efb8abf81` | `fb3340ebf4007f74b93729601d2b283b7b65e3b8` | [`6ee3533`](https://github.com/cheaper-inference/OmniRoute/commit/6ee3533a1223e79b6622e91188cf4c2efb8abf81) changes the dashboard combo-name regex to allow spaces and square brackets. |
| [OmniRoute #2464](https://github.com/cheaper-inference/OmniRoute/pull/2464) | `5c41bbc22a136c8fcf025e38742bb5490c524025` | `2851b938bc989c7f879f098498d99be6f2894a5b` | [`5c41bbc`](https://github.com/cheaper-inference/OmniRoute/commit/5c41bbc22a136c8fcf025e38742bb5490c524025) exports the Antigravity pre-response timeout code, propagates it through the error result, and removes message-text matching from timeout fallback detection. The enclosing merge also contains the earlier PR work that adds the header-readiness timeout and connection fallback path; that unrelated merge content is not attributed to #2464. |
| [OmniRoute #2989](https://github.com/cheaper-inference/OmniRoute/pull/2989) | `1a701292b6c738934da85f7aad359f765d28fe5e` | `923b8fe14f3345cfd6a3d59fa658b25ec51cc02e` | [`1a70129`](https://github.com/cheaper-inference/OmniRoute/commit/1a701292b6c738934da85f7aad359f765d28fe5e) removes a duplicate same-scope `const settings` declaration in `handleChatCore` and adds an import guard. The merge also carries other release changes. |

## Current behavior and fixture evidence

### #2458 — bracketed combo names

The PR-specific diff only relaxes the dashboard-local regular expression to allow spaces and `[` / `]`. Current management policy is stricter and is enforced server-side in [`comboManagement.js`](../../../src/lib/combos/comboManagement.js): `VALID_NAME_REGEX` accepts only letters, digits, `_`, `-`, and `.`, and both create and rename call `assertValidName`. The dashboard's Create/Edit action therefore cannot successfully persist a bracketed name through the current API. Existing routing resolves stored combo names by their canonical name (covered by [`combo-case-insensitive.test.js`](../../../tests/unit/combo-case-insensitive.test.js) and [`combo-prefix-resolve.test.js`](../../../tests/unit/combo-prefix-resolve.test.js)); those fixtures do not establish support for creating or editing names with brackets.

The management fixture [`combo-management.test.js`](../../../tests/unit/combo-management.test.js) proves the current API validation boundary and acceptance of `fast-2.0_x`. [`combo-presets.test.js`](../../../tests/unit/combo-presets.test.js) separately proves preset IDs reject spaces and slashes. These are intentional format policies at distinct seams, not evidence of a routing failure for an already stored combo.

**Disposition — do not port #2458 as-is.** The dashboard-only relaxation would still be rejected by the current API and would create a misleading UI affordance. No current routing/display regression is demonstrated. If product requirements later authorize bracketed names end-to-end, first define a narrow shared name policy across dashboard, API, persistence/import, and displayed combo references, then add offline tests for accepted/rejected names plus exact and case-insensitive lookup. Do not change provider routing ownership as part of such work.

### #2464 — Antigravity timeout settlement and fallback

The PR-specific review follow-up makes the timeout identifier a shared constant and preserves it as structured result metadata; it removes a fallback check that searched human-readable error text. The enclosing merge’s earlier timeout implementation creates a bounded wait for response headers, tags a confirmed local deadline, surfaces it as a gateway timeout, and lets the account selector try another connection. It explicitly treats a received-headers stream readiness/EOF condition differently from a pre-response timeout.

Current code already follows that structured distinction using the fork's transport policy. [`base.js`](../../../open-sse/executors/base.js) enforces `headerTimeoutMs`, identifies its own deadline by abort-reason identity, and marks only a confirmed Antigravity deadline with `antigravityPreResponseTimeout`. [`chatCore.js`](../../../open-sse/handlers/chatCore.js) maps that marker to 504. [`chat.js`](../../../src/sse/handlers/chat.js) excludes a timed-out connection and retries an eligible sibling, while pinned connections return the failure and replay suppression remains attached to the response. Ordinary stream settlement and empty-stream handling have their own callbacks and account-scoped fallback behavior.

Offline fixture evidence is in [`omni-antigravity-timeout.test.js`](../../../tests/unit/omni-antigravity-timeout.test.js): it checks deadline classification, no retry for the same timed-out transport despite an explicit retry rule, preservation of a caller abort as a caller abort, no replay of a received upstream 504, and suppression of transient replay after an exhausted account sweep. Existing stream-tail fixtures include [`omni-chat-heartbeat-tool-fragments.test.js`](../../../tests/unit/omni-chat-heartbeat-tool-fragments.test.js) and [`v5-translated-stream-error-boundaries.test.js`](../../../tests/unit/v5-translated-stream-error-boundaries.test.js), which cover fragment forwarding and terminal/error boundaries offline. This review found no fixture evidence of premature settlement or a stalled stream tail in the current code.

**Disposition — no port.** The behavior requested by the public change is already implemented through the current transport and routing ownership seams, with structured provenance and offline fixtures. The exact #2464 review follow-up's narrower code-constant/message-match changes do not expose an additional behavior gap here. If a future fixture demonstrates a missing case, add an offline test at the executor and account-selection boundary; verify that pre-response deadlines rotate only eligible accounts, received-header stream failures do not masquerade as connect deadlines, and caller aborts remain local. Preserve current sign-in, provider routing, affinity, and account-selection ownership.

### #2989 — duplicate declaration

The public patch deletes a second `const settings` declaration that made its upstream `chatCore.ts` fail transformation. Current [`chatCore.js`](../../../open-sse/handlers/chatCore.js) contains no `const settings` declaration in the function and no duplicate declaration regression. Existing offline tests import the current module directly, including [`kimi-signin-parity.test.js`](../../../tests/unit/kimi-signin-parity.test.js), [`daoxe-provider.test.js`](../../../tests/unit/daoxe-provider.test.js), and [`headroom-chat-core.test.js`](../../../tests/unit/headroom-chat-core.test.js). Other fixtures import it dynamically, including [`responses-file-id-chatcore.test.js`](../../../tests/unit/responses-file-id-chatcore.test.js). These imports are executable transform/initialization evidence for the current JavaScript module; this review did not run the suite.

**Disposition — no port.** The duplicate declaration is absent in the current implementation, and the current test inventory already imports the module. There is no existing behavior gap to qualify. If the source is later consolidated into a same-scope declaration, ordinary offline acceptance is a focused import/transform test plus the existing chatCore caller tests; no live provider traffic is needed.

## Review boundary

This is a source and fixture review only. No product source, tests, workflows, contributor instructions, baselines, provider routing, sign-in behavior, or user data were changed. No credentials or live provider traffic were accessed. The report does not treat the pinned PRs' surrounding release merges as PR-specific evidence.
