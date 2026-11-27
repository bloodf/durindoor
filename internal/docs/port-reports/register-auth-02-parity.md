# Register auth batch 2 (#2034)

Status: implementation checkpoint; blocked before test collection and not qualified for integration.
Prepared base: `8f4fc37ee7`. No prior `register-auth-02` candidate/gate record
was present in the explicit local repository's `.orq/units` directory.

## Changes in this checkout

- Qwen OAuth (`qwen` / `qw`) uses the staged device handler from
  `src/lib/oauth/providerParity/qwen/index.js` through the existing provider
  table. The shared flow still owns PKCE, claims, state, proxy selection and
  persistence. This does not activate or change Qwen Cloud API keys (`qwc`).
- iFlow's existing cookie route calls the staged `importIflowCookie` helper,
  forwards cancellation and returns no key prefix or upstream error body.
  OAuth exchange/profile failures return generic messages.
- Kiro registration uses `buildKiroRegistration`; the existing Builder ID/IDC
  distinction, region, organization start URL and selected proxy are retained.
  The batch test exercises both methods through the public provider API.
- Public GitHub device polling uses `decodeCopilotPollResponse`, reducing
  untrusted bodies to known protocol fields.
- GHE background refresh uses `refreshBoundGheCopilotCredentials`.
  Discovery and validation use the connection-aware outbound guard, selected
  proxy and issuer. Discovery sends the session credential, never substitutes
  the long-lived OAuth token.
- GHE executor no longer bypasses the bound transport for API-only legacy
  rows. An operator-stored API URL cannot establish an OAuth issuer. Reconnect
  such rows with the explicit enterprise host. Existing issuer-bound enterprise
  routing still uses the existing custom-host/outbound policy.
- Copilot background token saves compare the sending credentials, durable
  provider metadata and available row revision under the database writer lock.
  A failed comparison does not expose the new session token for dispatch.
  After an accepted primary refresh, the secondary exchange uses the committed
  row revision. No database schema or credential-manager changes are made.

## Sources and contract changes

Profiles remain immutable in `src/lib/oauth/providerParity/`. Their registration
manifests identify the integration slots. GHE's connection helper attributes
its contracts to CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864`,
`internal/auth/copilot/client.go`, and OmniRoute
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`,
`src/lib/oauth/providers/ghe-copilot.ts`.

The iFlow staging-only negative route assertion now positively checks the
helper call. Protocol/security/usage assertions remain. The Copilot exact-call
assertion in `port9r-proxy-refresh-884.test.js` now requires the atomic guard
and exercises current, reconnected and deleted rows. Its saved-proxy assertion
is retained. The former API-only GHE bypass is unsafe because neither an
issuer nor a scoped credential is established by an arbitrary API URL.

## Evidence and limits

Source syntax checks for every changed JavaScript file and `git diff --check`
passed in a fresh private environment. Evidence:
`/var/tmp/durindoor-register-auth-02.ennSedvc/source-checks.log`.

The requested five-file Vitest command was attempted with two workers,
`--no-cache`, `umask 077`, private HOME/DATA_DIR/TMPDIR/cache/store paths and
`env -i`. It failed before collection because the borrowed dependency graph
cannot resolve `playwright/package.json`. Evidence:
`/var/tmp/durindoor-auth02-check.oyZr4NZj/vitest.log`.
Scoped lint and anti-slop also cannot start: their CLI modules are absent in
that graph. Final syntax/whitespace checks pass; command output is preserved in
`/var/tmp/durindoor-auth02-check.oyZr4NZj/final-source-and-lint.log`.

This checkout has private dependency mirror directories containing links to
existing packages; borrowed packages/stores remain unmodified. No installation
or repair was attempted after the graph failure. No machine changes, live
calls or browser work were performed. CodeGraph is unavailable (the repository
wrapper exits with `CodeGraph 1.6.2 required`).

## Remaining qualification work

- Run and fix the complete requested mocked suite using isolated gate setup;
  retain every valid scenario. Review older GHE routing tests that encoded the
  removed API-only OAuth forwarding behavior; strengthen their refusal
  contracts rather than dropping coverage.
- Complete public route coverage for both GHE hosts across device, exchange,
  refresh, discovery and all supported buffered/streamed dispatch formats.
  The new CAS tests use the real refresh orchestration and a mocked atomic
  writer, not an independent SQLite race run.
- Review GHE legacy-client and missing-expiry acceptance in the immutable
  staged helper against pinned source. Current integration alone does not
  establish safe provenance for every historical row. Do not claim lifecycle
  parity while this remains unresolved.
- Verify CLI reachability and remaining source-supported metadata differences.
  The standalone legacy iFlow service remains source-inapplicable: its missing
  server-credential module is covered by the retained unsupported-contract test;
  the shipped CLI uses shared dashboard flow submission.
- Refresh Storybook hashes through the normal generator only if surfaces
  change. No approval data has been changed here.
- Qwen Cloud regional discovery belongs to sync plan 102,
  `2034-qwen-cloud-regional-request-discovery`. Its exact gated/reviewed head
  is pending. Do not duplicate implementation or claim `qwc` parity.

No push, PR, merge or integration qualification is authorized by this report.
