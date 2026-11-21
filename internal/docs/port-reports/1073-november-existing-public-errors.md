# #1073: Existing public provider error identifiers

## Pins and scope

This is a static comparison of the exact PR-head patches. The supplied enclosing merge pins are recorded for provenance; where a merge contains unrelated PR changes, the comparison uses the named PR head and its direct parent.

| PR | Exact head | Enclosing merge | Head parent | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #18272](https://github.com/cheaper-inference/OmniRoute/pull/18272) | `bcfe5534c044c02d26027266a85536d946305dda` | `556b86d48bd20fe13d31f1705be04e8ba9d89201` | `ba5e8af8b4b47dc54a03ffa53d6b6b47eae0e04b` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/bcfe5534c044c02d26027266a85536d946305dda) |
| [OmniRoute #19097](https://github.com/cheaper-inference/OmniRoute/pull/19097) | `adb94ba72f0047d9c7ff31701372b0092fabe4f5` | `ea5473173b0f6f67bc56a1cbc0089f34a3b8c0a7` | `a9dc9c799a35a0022d3df6a2528b52afd12d8cdc` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/adb94ba72f0047d9c7ff31701372b0092fabe4f5) |
| [OmniRoute #19504](https://github.com/cheaper-inference/OmniRoute/pull/19504) | `5d2d165254d4872fe54b4adf39155ceb9a648655` | `b415900fd4118dc4b5405521e00f0e5e9f0bb931` | `8db028cb0d122e78e9c1b2274fbe67da2f235144` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/5d2d165254d4872fe54b4adf39155ceb9a648655) |

Only the changes at those heads are assessed. In particular, #18272 and #19097 each change one Stryker mutation-test allowlist entry; neither changes a provider error response. #19504 changes translated request-failure handling, adds `thread_unsupported_request` to OmniRoute's public-safe identifier allowlist, and adds fixture assertions for that identifier and unsafe-code rejection.

## Current local behavior and fixture evidence

- **Ordinary streaming:** `tests/unit/keepalive-error-frame-status.test.js` exercises post-keepalive provider failures in Responses, Chat Completions, and Claude Messages formats. The fixtures retain the provider's established error code/type where the format supports it and retain HTTP status and `Retry-After` in their established format locations. The Claude case verifies the Anthropic error envelope and `status_code`.
- **Translated streaming:** `tests/unit/v5-translated-stream-error-boundaries.test.js` imports translator registrations and drives the actual final response stream with offline fixtures. Its translated Claude and Responses cases retain established `type`, `code`, and message on ordinary provider errors; redact fixture credentials/diagnostics; and assert one failure terminal, error persistence, and no success terminal. `tests/unit/v5-1342-gemini-prompt-feedback-error.test.js` separately verifies that a translated Claude error is emitted as an error event and that persisted status remains `error`.
- **Nonstream status:** `tests/unit/chat-exhausted-status.test.js` verifies ordinary nonstream provider-error HTTP status preservation through combo exhaustion, including 400 and 429 with retry metadata. Its chatCore fixture also documents the existing deliberate 401-to-client-404 normalization while retaining the source status internally. These fixtures establish status handling; they do not establish a generic `error.details.error_code` contract.
- **Scope boundary:** Local fixtures demonstrate existing error envelopes, identifiers, sanitization, and status retention, but no translated Claude thread-refusal route or equivalent `details.error_code` continuation contract was found. Existing route coverage is not evidence that `thread_unsupported_request` should be added to this fork's taxonomy.

## Disposition

- **#18272 — Do not port.** Mutation-test inventory maintenance only. It adds no public error behavior and its test-name entry is specific to OmniRoute's Stryker setup. The local streaming fixtures already exercise the corresponding public error status behavior.
- **#19097 — Do not port.** Mutation-test inventory maintenance only. It adds no public error behavior and its sanitized-error test registration is specific to OmniRoute's Stryker setup. Local fixtures already cover the existing public error boundary and sanitization behavior.
- **#19504 — Defer; no narrow gap demonstrated.** The PR introduces a new public identifier for a Claude thread refusal and allows a thrown translation detail code to survive into `error.details.error_code`. Current local fixtures support retaining established provider identifiers and status, but do not show an existing thread-refusal contract to preserve. Adding this new taxonomy would exceed this audit's existing-contract scope. Revisit only with a separately established local route contract and a corresponding ordinary offline fixture.

No implementation or test change is proposed. Since this comparison demonstrates no narrow behavior gap, there is no additional offline acceptance test to add; the cited existing offline fixtures are the acceptance evidence for the behavior already supported.
