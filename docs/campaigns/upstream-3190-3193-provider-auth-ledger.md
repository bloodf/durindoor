# Upstream Provider-Auth Ports — #3191, #3193 (2026-08-11)

Two verified `decolua/9router` provider-auth gaps were ported after checking the
fork's registry and connection-test behavior. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3191](https://github.com/decolua/9router/pull/3191) `fix(tokenrouter): add dedicated API-key connection validation` | PORTED | TokenRouter's registry has a `/v1/models` validation endpoint, but `testApiKeyConnection` had no TokenRouter case. The generic registry probe reports unsupported after a 403 instead of diagnosing its API key or configured base URL. | Probe `${baseUrl}/models` with Bearer authentication; preserve configured `providerSpecificData.baseUrl`. Tests cover success URL/header and 403 error behavior. |
| [#3193](https://github.com/decolua/9router/pull/3193) `fix(kimchi): expose API-key authentication and validate it` | PORTED | Kimchi declared only `oauth` despite its API-key gateway flow, so provider creation could not select API-key auth. Its test route also lacked an API-key validation case. | Advertise both `oauth` and `apikey`; validate API keys at CAST AI's supported-providers endpoint with Kimchi's required User-Agent. Registry and connection-test regressions cover the behavior. |

## Adaptations

- Kimchi's fork-local OAuth constant exposes `KIMCHI_CONFIG.validationUrl`, so the validation case reuses that configured endpoint instead of hardcoding a duplicate URL.
- TokenRouter keeps its existing per-connection base-URL override; the validator normalizes one trailing slash before appending `/models`.

## Verification

- RED: `cd tests && node_modules/.bin/vitest run --root . --config vitest.config.js unit/kimchi.test.js unit/provider-test-utils.test.js` exited 1: Kimchi auth modes lacked `apikey`, and its API-key connection test returned `valid: false`.
- GREEN: same focused command exited 0: `Test Files 2 passed`, `Tests 32 passed`.
