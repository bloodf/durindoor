# OmniRoute #21080 and #21082: Cline retry hint and Kilo paid-model denial scope

Source rows 9 and 11 of the [#1073 Nov 24 disposition](1073-nov24-commits-1.md). Fetched 2026-11-24 with `gh pr view` and `gh pr diff` against `cheaper-inference/OmniRoute`.

| Upstream PR | State | Head | Merge commit |
|---|---|---|---|
| [#21080](https://github.com/cheaper-inference/OmniRoute/pull/21080) `fix(sse): honor Cline daily free-limit countdown as a model lockout hint` | merged 2026-11-24T15:51:03Z | `b1ace531875a5640ead3ff1dd2d188b9c163b985` | `b65b8a728ccc8b97cfe5d61509c047635fd92aea` |
| [#21082](https://github.com/cheaper-inference/OmniRoute/pull/21082) `fix(sse): lock only the model on Kilo PAID_MODEL_AUTH_REQUIRED` | merged 2026-11-24T15:52:41Z | `56d1842a74c48b49b7e2487114350b1eb91bf12a` | `af292fe49fd207de99c2c73d9454a777ac51d0e2` |

DurinDoor PR: **none linked yet**. This report does not claim a completed port until the PR URL is recorded in the section below.

## Gaps confirmed on this checkout (base `640c0882e7`)

- Cline: `checkFallbackError(429, "Daily free limit reached on model cline-free/solar-pro4. Try again in 19h 39m", 0, "cline")` returned `cooldownMs: 2000`. No parser for `try again in` existed under `open-sse/`.
- Kilo: a 401/402/403 with `PAID_MODEL_AUTH_REQUIRED` fell through to the shared status rules (120 s, `scope: null`). `markAccountUnavailable` then locked the requested model scope, which collapses to `modelLock___all` for any id outside the provider catalog, benching free models on the same connection.
- Open DurinDoor PRs (`gh pr list --state open`): #2483, #2481, #2430, #2112, #1809, #1784. None touches `accountFallback`, `providerErrorRules`, `accountErrors` or Cline/Kilo files by title or branch; recheck file lists before merge.

## Adaptation

Upstream's `modelScopedAccessDenial.ts`, `errorClassifier.ts`, combo target-exhaustion and `chatCore.ts` plumbing have no DurinDoor counterpart. DurinDoor routes the same decision through provider rules and `markAccountUnavailable`:

- `open-sse/services/accountFallback/clineTryAgainIn.js`: bounded-quantifier parser for `Try again in XhYmZs` (spaced, glued, partial). Gated on `cline`/`cl`. Returns `null` for absent, zero or malformed durations; caps at `MAX_RATE_LIMIT_COOLDOWN_MS`.
- `open-sse/services/accountFallback.js`: the 429 branch of `checkFallbackError` uses the hint (`scope: "model"`, backoff level reset) before the existing quota-evidence and generic paths. Other providers and Cline without a hint are unchanged. `modelOnly` from a provider rule is forwarded.
- `open-sse/config/providerErrorRules.js`: Kilo rule on `kilo-gateway`, `kilocode` and aliases `kg`, `kc`. Status 401/402/403 only; exact, case-insensitive code `PAID_MODEL_AUTH_REQUIRED` read from top-level `error_type`/`code`/`type` or `error.code`/`error.type`, in the structured body or JSON error text. The message alone never matches; a message naming an invalid, expired, revoked or missing key keeps the authentication path. Scope `model`, 2 min.
- `src/sse/services/auth/accountErrors.js`: a `modelOnly` denial whose model has no bounded scope returns `{ shouldFallback: true, cooldownMs: 0 }` with no lock, instead of widening to `modelLock___all`.

### Differences from upstream

- Cline cap is the provider cooldown ceiling (7 days) rather than upstream's 30 min operator cap; DurinDoor has no equivalent operator knob, and the report's gap asked for the stated window.
- Passthrough Kilo ids (not in the catalog) get no lock because DurinDoor lock keys are bounded to catalog ids; upstream locks the raw model.
- Not ported: classifier `MODEL_NOT_FOUND` mapping, combo exhaustion sets, provider-breaker assertions (subsystems absent locally).

## Evidence

- `tests/unit/port-omni-cline-kilo-fallback-21080-21082.test.js`: 14 tests. Cline parser forms, malformed/zero/negative/huge input, provider gating, cap, JSON envelope, non-429 and no-hint behavior. Kilo: three envelope shapes, structured vs text body, statuses 401/402/403, both providers and aliases, exact-code match, credential-message and other-provider/status guards, and `markAccountUnavailable` lock keys (only `modelLock_kilo-auto/frontier`; no lock for an unlisted id; credential failure still writes `modelLock___all`).
- `cd tests && node node_modules/vitest/vitest.mjs run` on that file plus 15 neighbouring fallback, provider-rule, Kilo, Cline and Y-API files: 16 files, 198 tests passed. `tests/__baseline__/known-fails.txt` untouched. No credentials, production gateway or machine settings were used; all probes call pure functions or mocked storage.
- Docs: note added to `docs/features/error-rules-and-egress-cooldown.mdx`.

## PR

Pending.
