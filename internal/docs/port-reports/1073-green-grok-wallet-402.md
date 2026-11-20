# #1073: Grok wallet 402

## OmniRoute #20461 — existing local behavior; no runtime port

Source: https://github.com/cheaper-inference/OmniRoute/pull/20461

Rechecked 2026-11-20: open, non-draft, clean and mergeable, at `d67892c0c274a8254d97c019a3758bc6dfd0632c`; the CI gate succeeded. The diff changes the upstream shared-wallet classifier so an empty 402 no longer signifies shared credit exhaustion; explicit usage-balance evidence still does.

DurinDoor has no corresponding shared-wallet classifier or cross-connection shared-wallet exhaustion state. `open-sse/services/accountFallback.js` and `open-sse/config/errorConfig.js` classify a bare 402 as terminal with a 120-second cooldown and fallback; explicit insufficient-credit text retains that terminal treatment. `src/sse/services/auth.js` writes fallback state for the selected connection, and `open-sse/services/fallbackScope.js` resolves a known catalog model to its model lock. Thus an empty 402 for a known Grok model does not lock another model or connection. `open-sse/services/accountFallback.js` checks both exact and account-wide locks and preserves normal 429 backoff.

The bounded-key safeguard deliberately maps unknown or missing model IDs to the account-wide scope; this is not upstream shared-wallet inference and is retained. Explicit credit text likewise does not create a separate shared-wallet state in this fork. No identity, authentication, provider or runtime code was changed.

`tests/unit/omni-green-grok-wallet-402.test.js` exercises synthetic Grok CLI and Grok Web classifications, known-model lock isolation, another connection, explicit credit text and ordinary 429 backoff. It does not call a provider.

Validation: the requested report checks passed, but the focused Vitest command could not start: the linked test dependency tree could not resolve `vite` from `tests/vitest.config.js`. Dependencies were not installed or changed; the fixture remains unverified until that environment is repaired.
