# Cookie public authorization fixture (#2034)

The fixture accepts per-dispatch `headers` and `body` overrides. Defaults remain in place when omitted; body overrides are serialized without filtering so production request parsing sees them. Management authority is mocked separately from client API-key validation.

The focused suite uses synthetic imported Tencent accounts, real SQLite keys and public routes with a stubbed provider transport. It exercises connection scopes, request isolation and cancellation. It does not establish live provider acceptance, real operator identity, browser capture, or production deployment behavior. Fixture instances use process-global module and environment state and must be closed before another is opened.

The forged body check establishes that the admitted key ID and billing epoch supplied to the usage writer do not come from the forged values, and that a successful request makes one transport call. A separate 401 refusal still falls back to the second authorized account with a forged retry count and retains the admitted billing identity. This does not prove handling of every possible internal marker or every retryable failure. The sequential-instance check establishes that the first key is invalid in the second database; it does not demonstrate simultaneous fixture isolation, since the helper resets process-global modules and environment. The existing Tencent suite covers anonymous dispatch under its fixture's real default settings and its separate capture/parser cases.

Validation: the new suite and `cookie-flow-tencent-aistudio-web-2034.test.js` passed (39 tests total); the anti-slop check passed. Provider responses were synthetic. No live provider acceptance was attempted.

Root lint components: direct ESLint completed with 0 errors and 348 warnings; the direct anti-slop check completed with 0 diagnostics using the existing bundle. The bundle regeneration step was not run.
