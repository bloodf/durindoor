# Liquid native System One — #2644

Ported from the complete current OmniRoute #21338 diff, inspected 2026-11-27:
https://github.com/cheaper-inference/OmniRoute/pull/21338

Base: `16e2c146fb5b8e4ee6364fb679ffe412880757fb`.
Head: `9bcaa77898e644255949ce94123a6899fc0e2dd0` (five commits, four files).
The head commit alone is the unrelated validator revert described in
`omni-review-verified.md`; the complete PR diff contains the native decisions
resolver, route guidance, changelog and offline tests. No validator patch was
ported.

Adapted to DurinDoor's registry-driven System One handler instead of importing
OmniRoute's target resolver. Liquid has both chat and decision catalog rows;
validated resolved wire IDs only enter the body. The fixed decisions endpoint
ignores host metadata, refuses redirects and preserves proxy handling. OpenRouter
Liquid routes retain their own provider identity and credentials. Resolved aliases
are validated before credential selection, with a second core dispatch check.

Offline tests cover native dispatch, usage and answers, malformed IDs, fixed host,
proxy forwarding, redirect refusal, and Liquid versus OpenRouter credential
selection. Existing custom/Laya guard tests remain part of validation. The routing
handler now uses admission's settings snapshot instead of an undefined getSettings
call exposed by the dispatch tests. No provider calls or decision probes were made.

## Validation

- `pnpm run lint` passed (existing warnings, zero errors).
- Offline focused run: 69 assertions passed across `systemoneCore`,
  `systemone-connection-pin`, `liquid-api-base-url`, `laya-systemone`,
  `systemone-envelope-port`, and `openrouter-catalog` unit test files.
- Both registry and agent index generators ran; their outputs were unchanged.
- The existing Liquid chat catalog assertion now filters out System One rows;
  the chat-model list, discovery and validation endpoint contracts still pass.
- The full CI suite detected a pre-existing stale Storybook endpoint-page hash.
  At local base `d95e1011806b11842c375971d8263bb69666b613`, the committed
  manifest records `11fba39ddc2717417015a5d2598a43c9d98790177f0767cc5f0cccd8de73a86a`
  for `EndpointPageClient.jsx`, while the committed source hashes to
  `a09c53042f75e68076ff50756ebf518367f626f288afae1356088ed5170d0d74`.
  Neither file is changed by this port. No failure baseline entries were added.

All 12 CI batches completed. The full run recorded two failures: the stale
Storybook inventory above and the Liquid chat-only assertion before it was
updated. The corrected assertion passed in the 69-test focused rerun; the full
suite was not rerun after that test-only correction. The complete CI gate is
therefore not green. Root lint and commitlint from `origin/main` to `HEAD` pass.

## Gate evidence follow-up

The evidence gate selects `tests/unit/liquid-systemone-review.test.js` explicitly.
That standalone offline suite now covers dispatch through the real proxy transport
with a stubbed fetch boundary: fixed Liquid host, ignored host metadata, model-ID
validation, redirect refusal, and separate OpenRouter credentials and endpoint.
The existing Liquid catalog contract now asserts the complete six-model inventory
and exact model kinds as well as retaining its three-chat-model assertion; no
unexpected model rows are ignored by the complete-inventory check.

Validation: the exact gate selector passed 13 tests. The combined seven-file
Liquid/System One/OpenRouter/Laya focused run passed all 82 tests. No production
code changed in this follow-up, and no live provider requests were made.
