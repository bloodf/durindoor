# Bedrock discovery profile transport boundary (#2034)

Private discovery correction; no public registration or wiring. Base checkout:
`e0e7abaf9d74cb84d7e78bf204603bcf995dec90`. Review context supplied for
`db7457b262acda451b6ce4887bf1058474079b24` against
`dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`.
Source freeze: 2026-11-27T23:49:25.752045Z. No upstream refresh performed.

Attribution retained: OmniRoute (MIT), Copyright (c) 2026 Cheaper Inference -
Created by Diego Souza, source commit `3a17f7e908308a217887a7617c2c793b95ea83c0`.

## Before-fix evidence

The old action handler allowed STS, portal.sso and oidc origins in profile mode.
It constructed `buildBedrockClientAuth` before checking any effective route;
that calls `fromIni({ profile })`. A selected proxy/relay could therefore apply
to Bedrock actions while the separate credential chain had no equivalent route
contract. The original comment incorrectly claimed the chain reused the parent
handler and the deadline bounded all credential work.

The exact new 19-test suite against the base version of `index.js` failed 11
cases and passed eight: seven connection/explicit/strict route refusals, one
environment-proxy refusal, and three STS/SSO origin refusals failed. Fixtures and
all transports were synthetic. The custom-host refusal already passed.
Raw reproduction: `/var/tmp/profile-boundary2034.nrt5ookc/before.log`.

## Pinned SDK source inspection

Read-only installed dependency source under
`/var/tmp/bedrock2034.Ws407B/repo/node_modules` was inspected; no real profile
resolution or live call was executed. Pins inspected:

- `@aws-sdk/client-bedrock` 3.1132.0 (the action client).
- `@aws-sdk/credential-provider-ini` 3.973.16, `dist-cjs/index.js`:
  `resolveAssumeRoleCredentials` constructs a separate role assumer with optional
  `clientConfig` / `parentClientConfig`; `resolveSsoCredentials` calls `fromSSO`;
  `resolveProcessCredentials` calls `fromProcess`. The shared helper supplies
  only `{ profile }`, with no selected proxy transport or cancellation contract.
- `@aws-sdk/credential-provider-sso` 3.973.15, `dist-cjs/index.js`:
  `resolveSSOCredentials` creates its own `SSOClient` from `clientConfig` and
  selected logger/region/user-agent values. The parent Bedrock action handler is
  not a universal transport for that chain.
- `@aws-sdk/nested-clients` 3.997.45, `dist-cjs/submodules/sts/index.js`:
  separate STS clients can use an explicitly configured or compatible inherited
  handler. This optional STS behavior does not supply an all-chain guarantee;
  SSO, token refresh and credential processes have separate boundaries.

Consequently no claim is made that all profile credential traffic uses the
selected route, fixed origin, response-body cap, or cancellation signal. The
outer promise race only bounds caller wait; it cannot terminate independent
credential-chain networking/processes. No AWS list permissions were tested.

## Correction and supported modes

`resolveCredentialProxyOptions` merges persisted connection metadata and explicit
options, including the durable `oauthProxy.mode` contract. Before auth/provider
construction, profile mode calls the existing `resolveProxyForRequest` for the
fixed action origin. Any non-direct source or strict route is rejected with a
fixed `ProfileRouteUnsupported` configuration error. An injected callback cannot
bypass this guard. No direct fallback occurs under that binding.

An effective direct named profile still uses the unchanged shared helper and
real SigV4 action client, subject to the credential-chain limitations above.
Durable direct selection wins over stale connection/explicit proxy options as
specified by the existing merger. Static IAM/session credentials and Bedrock
bearer keys keep their selected proxy handling. No auth fallback or global
credential chain was introduced; the selected auth scheme is reasserted after
the auth merge, independently of the refusing opposite-identity provider.

The action handler now accepts only the exact fixed Bedrock control-plane
origin. STS/SSO/custom targets are refused before forwarding any signed headers.
Redirect refusal, bounded action response reads, real SDK wire/action query
serialization, normalization and existing cancellation behavior remain covered
by the untouched original discovery suite.

## Validation

All verification used `env -i`, explicit PATH/LANG/CI, private HOME/DATA_DIR,
TMPDIR/cache/store under `/var/tmp/profile-boundary2034.nrt5ookc`, a 300-second
command ceiling and at most two test workers. Borrowed dependencies were read
only; no installs, repair, deletion or relinking through borrowed links occurred.
A private source snapshot imported the tracked Vitest configuration through a
scratch wrapper with a private Vite cache directory and disabled result cache.
No package-manager lint command was used.

Focused command from the snapshot's `tests/`:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/fix-bedrock-discovery-profile-boundary-2034.test.js \
  unit/bedrock-sigv4-discovery-2034.test.js \
  unit/bedrock-aws-credentials.test.js \
  --config boundary.config.mjs --configLoader runner --maxWorkers=2 --no-cache
```

Results on the final code/test snapshot: 3 files, **80 passed** (19 new + 35
unchanged discovery + 26 unchanged AWS credentials). Raw output:
`/var/tmp/profile-boundary2034.nrt5ookc/after.log`.

Root lint components were invoked directly and separately:

```sh
node node_modules/eslint/bin/eslint.js src
node scripts/build-anti-slop-plugin.mjs
node scripts/check-anti-slop.mjs
```

All exited 0. Root ESLint reported 0 errors and 348 existing warnings in
untouched `src/`. Anti-slop reported 0 diagnostics across 3711 files. The generated
bundle existed only in the private source snapshot; no tracked bundle changed.
Direct ESLint on the implementation and new test also exited 0 with no findings.
`git diff --check` passed. CodeGraph retrieval was attempted but the pinned CLI
was unavailable in the isolated PATH; bounded source inspection supplied the
helper/dependency evidence instead.

The new suite covers refusal before `fromIni`, credential-provider invocation,
callback or transport; direct-profile SigV4 with ambient bearer decoy; two-account
static and bearer proxy positives; live-handler STS/SSO/custom-host refusals;
callback success, caller abort, deadline and provider rejection redaction.

Historical staging results and live-check limits remain in the original report
and handoff, with the incorrect all-host transport claim corrected. Protected
paths, both original test files, shared credentials helper and runtime executor
remain unchanged. No baseline entries, skips or weakened assertions were added.
No live providers, real AWS profiles, user credentials, builds, full inventory,
CI orchestration or browser checks were used. Exact-head independent review and
any broader gate remain outside this requested verification scope.
