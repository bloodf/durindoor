# #1073 Existing media polling safeguards and operator defaults

## Pins and review scope

- OmniRoute #20824 head: [`46259366085f853b727ae04883fc48c266922ff7`](https://github.com/cheaper-inference/OmniRoute/commit/46259366085f853b727ae04883fc48c266922ff7)
- Enclosing merge: [`76b26b8ead943efd7ae5fa8e65c5551cb392adb1`](https://github.com/cheaper-inference/OmniRoute/commit/76b26b8ead943efd7ae5fa8e65c5551cb392adb1)
- PR: [OmniRoute #20824](https://github.com/cheaper-inference/OmniRoute/pull/20824)

The supplied public source mirror did not contain either pinned object at review time, so the exact patch could not be inspected. The local findings below are source and fixture evidence only; no unsafe case was triggered and no provider traffic was made. The PR disposition is therefore **unresolved pending exact patch availability**, rather than a claim of parity or a proposed port.

## Local safeguards and fixture evidence

The installed async image adapters share `POLL_INTERVAL_MS = 1500` and `POLL_TIMEOUT_MS = 120000` in `open-sse/handlers/imageProviders/_base.js`. Shared `sleep` rejects immediately for an already-aborted signal and interrupts its timer when the caller aborts. Status fetch/body helpers preserve aborts and classify lost observation of an accepted job as an unknown outcome.

NanoBanana and Magnific are installed adapters, as is the Black Forest Labs adapter; the latter is registered as `black-forest-labs`. `tests/unit/image-abort-signal.test.js` supplies offline fixtures for all three and verifies abort propagation to status fetches, no continued polling after abort, and HTTP 499 handling. `tests/unit/image-job-observation.test.js` supplies offline provider-shaped fixtures and checks lost-observation, provider-failure, and abort classification for each adapter. These fixtures do not establish values or bounds changed by #20824.

The other named media implementation, as it may appear in the public patch, cannot be identified without that patch. Locally, the three named adapters above are present. Existing default bounds are fixed constants, not operator-configurable polling settings in these adapters; I found no trusted operator polling override for them.

## Disposition

| PR | Disposition |
| --- | --- |
| [#20824](https://github.com/cheaper-inference/OmniRoute/pull/20824) (`46259366085f853b727ae04883fc48c266922ff7`, merge `76b26b8ead943efd7ae5fa8e65c5551cb392adb1`) | **Unresolved / needs exact diff.** Current local implementation has finite polling bounds and cancellation propagation with offline fixture coverage, but exact intended bounds and cancellation semantics cannot be compared because neither pinned patch object was available in the provided source mirror. No narrow gap is demonstrated; no code or test change is recommended on this evidence. |

## Acceptance evidence

The relevant ordinary offline fixture files are `tests/unit/image-abort-signal.test.js` and `tests/unit/image-job-observation.test.js`. No tests were run for this documentation-only comparison. Once the exact patch is available, acceptance for any demonstrated narrow gap should use these offline fixture patterns to establish the bounded polling and abort behavior, without live provider calls.
