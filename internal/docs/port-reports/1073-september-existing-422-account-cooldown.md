# #1073: Qualify existing 422 request-error cooldown behavior

## Public patch examined

- [OmniRoute PR #14739](https://github.com/cheaper-inference/OmniRoute/pull/14739), exact head `6d19cbd55117e50e87f41f86a30cb3596361f39a`.
- Enclosing merge: `8c36df2aba3f7d89c635af9efd856ac7a8f79569`.
- The pinned PR head is a quality-only follow-up folding the original 422 rationale into a comment. The behavior patch carried by the enclosing merge adds `HTTP_STATUS.UNPROCESSABLE_ENTITY` to the existing 400 branch in `open-sse/services/accountFallback.ts`, plus its focused tests and changelog. This report evaluates that named public patch, not unrelated merge contents.

## Current local behavior and evidence

The local `checkFallbackError` evaluates explicit terminal and provider error rules before its generic client-error fallback. Unmatched 4xx statuses other than 408 and 425 return without account fallback and with zero cooldown; they are marked `requestScoped` so combo routing may try another target. Therefore an ordinary validation 422 does not modify account cooldown state. Explicit recognized provider conditions retain their earlier classification, including throttling and model-access rules. See [`accountFallback.js`](../../../open-sse/services/accountFallback.js), especially the ordered classifier and its final 4xx branch.

The offline test [`account-fallback-request-scoped-4xx.test.js`](../../../tests/unit/account-fallback-request-scoped-4xx.test.js) checks 422 among deterministic request errors and separately asserts that a 422 with quota-exhaustion text still falls back. [`port-5cdcddf5-combo-request-scoped-4xx.test.js`](../../../tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js) asserts an unsupported-parameter 422 is request-scoped with zero cooldown, and exercises mocked combo responses advancing after a request-scoped error. These are ordinary local fixtures; no provider or account access is involved.

Provider-owned reasoning recovery remains earlier in the request lifecycle: [`cohere-422-recovery.test.js`](../../../tests/unit/cohere-422-recovery.test.js) uses mocked responses to verify that the specific Cohere reasoning-effort 422 is retried with `high`, while unrelated 422s are not retried. The request-scoped classification does not remove this recovery path.

Admission and accounting boundaries are independent of this classification. [`connection-circuit-state.test.js`](../../../tests/unit/connection-circuit-state.test.js) verifies that settling a request-scoped result releases its recovery lease without turning the circuit into an account failure. ChatCore continues to settle quota reservations on failed dispatches; its mocked boundary evidence is in [`chatcore-quota-reservation.test.js`](../../../tests/unit/chatcore-quota-reservation.test.js). This report does not propose changing admission, reservation settlement, or usage accounting.

## Disposition

**OmniRoute #14739: already covered; no local change recommended.** The public patch addresses the former catch-all transient cooldown for conventional 422 request validation. Current local behavior is broader: ordinary unmatched request-scoped 4xx responses already avoid account cooldown, while earlier provider-specific rules and reasoning recovery remain intact. No demonstrated narrow gap remains, so no additional regression case is proposed.
