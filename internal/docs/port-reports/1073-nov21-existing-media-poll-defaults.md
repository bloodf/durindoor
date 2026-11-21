# #1073 Existing media polling safeguards and operator defaults

## Pins and review scope

- OmniRoute #20824 head: [`46259366085f853b727ae04883fc48c266922ff7`](https://github.com/cheaper-inference/OmniRoute/commit/46259366085f853b727ae04883fc48c266922ff7)
- Enclosing merge: [`76b26b8ead943efd7ae5fa8e65c5551cb392adb1`](https://github.com/cheaper-inference/OmniRoute/commit/76b26b8ead943efd7ae5fa8e65c5551cb392adb1)
- PR: [OmniRoute #20824](https://github.com/cheaper-inference/OmniRoute/pull/20824)

The pinned [OmniRoute #20824 patch](https://github.com/cheaper-inference/OmniRoute/pull/20824) was supplied and reviewed. Its relevant production changes add caller-value bounds in `open-sse/utils/pollBounds.ts`, use them in NanoBanana/imageGeneration, Magnific, Black Forest Labs, and RenderHour image handling, pass the existing abort signal to the RenderHour media wait, and add an own-property guard to SYNTX provider rules. This report compares only those named boundaries with the current local checkout; it does not propose caller polling configuration or a new integration.

## Local safeguards and fixture evidence

The installed async image adapters share fixed `POLL_INTERVAL_MS = 1500` and `POLL_TIMEOUT_MS = 120000` defaults in `open-sse/handlers/imageProviders/_base.js`. These values are not caller-configurable in the local adapters. Shared `sleep` rejects immediately for an already-aborted signal and interrupts its timer when the caller aborts. Status fetch/body helpers preserve aborts and classify lost observation of an accepted job as an unknown outcome.

NanoBanana and Magnific are installed adapters, as is the Black Forest Labs adapter; the latter is registered as `black-forest-labs`. `tests/unit/image-abort-signal.test.js` supplies offline fixtures for all three and verifies abort propagation to status fetches, no continued polling after abort, and HTTP 499 handling. `tests/unit/image-job-observation.test.js` supplies offline provider-shaped fixtures and checks lost-observation, provider-failure, and abort classification for each adapter. These fixtures do not establish values or bounds changed by #20824.

The local image adapter registry contains NanoBanana, Magnific, and Black Forest Labs. It contains no RenderHour adapter, and the checkout has no separate RenderHour media handler. No SYNTX provider-rules handler or rules file is present under `open-sse`. The shared image-generation path supplies the request signal to adapter options; the three installed polling adapters use it for waits and status observation. These findings establish the local state of the named boundaries only; they do not establish parity for RenderHour or SYNTX.

## Disposition

| PR | Disposition |
| --- | --- |
| [#20824](https://github.com/cheaper-inference/OmniRoute/pull/20824) (`46259366085f853b727ae04883fc48c266922ff7`, merge `76b26b8ead943efd7ae5fa8e65c5551cb392adb1`) | **No local change indicated for the three installed adapters.** NanoBanana, Magnific, and Black Forest Labs already use fixed shared polling defaults and propagate cancellation through polling. The patch’s caller-value bounds do not establish a need to expose local caller polling configuration. RenderHour and SYNTX have no corresponding local handlers/rules to reconcile. This is a branch-level disposition based on the local source and fixtures below, not a parity claim for absent integrations. |

## Acceptance evidence

The relevant deterministic offline fixture files are `tests/unit/image-abort-signal.test.js` and `tests/unit/image-job-observation.test.js`. They cover cancellation propagation and job-observation outcomes for the installed adapters; they do not assert caller-value bounds from #20824. No tests were run for this documentation-only comparison.
