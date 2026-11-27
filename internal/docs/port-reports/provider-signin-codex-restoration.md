# Codex contract restoration (#2034)

Prior candidate: `c2bf2a11e87ab953bb1a35015f973b2fb9155304`, confirmed in the
explicit local repository's `.orq/units/signin-flow-codex/gate-1.json`.
Restoration base: `d62248bead6501d33855d07cf1c76c3ad801a1e5`.

The original 27-case file is byte-identical to that candidate, including every
semantic assertion, transport fixture, route call and staging assertion. No
obsolete contract exception was needed. Its seven original staging exports and
manifest slots were restored alongside the safe exchange export. The original
import normalizer is also byte-identical: SIWC/API-key guards, envelope stripping
and JWT expiry derivation are production changes. No registry/loading workaround,
new dependency or alternative auth framework was introduced.

The 23 exchange cases retain their names, parameter sets and all protocol/security
assertions in `provider-signin-codex-exchange-parity.test.js`. The sole difference
from the previous suite is its isolated manifest assertion: the export list must
contain `exchangeCodexCode` and its existing central slot, rather than require it
to be the only export. The original suite independently checks that the complete
manifest export list equals the actual module exports. No live-route assertion
was removed or weakened.

## Exact original testcase comparison

Each row is present unchanged, with all assertions byte-identical (old → restored):

1. `issues an S256 challenge and a fresh state and verifier per concurrent flow` — identical.
2. `binds a selected workspace and rejects a token for another account before saving` — identical.
3. `rejects conflicting or malformed workspace selections before any network call` — identical.
4. `rejects a wrong state before exchanging and never submits an accepted flow twice` — identical.
5. `accepts the alternate `usercode` field and a string interval like the source` — identical.
6. `keeps two concurrent accounts on their own device handle and proxy route` — identical.
7. `treats 404 as pending and reports other poll failures without the upstream body` — identical.
8. `refreshes two accounts concurrently on their own token and proxy and shares one in-flight call` — identical.
9. `marks a rejected refresh token unrecoverable without logging the upstream body` — identical.
10. `keeps a transient failure retryable and rejects a refreshed token for another workspace` — identical.
11. `returns a retryable null when the refresh deadline aborts the request` — identical.
12. `discovers models per account without crossing bearer or account headers` — identical.
13. `sends each account's own bearer, account header and session on executor requests` — identical.
14. `translates a chat request to Responses and a Responses stream event back to chat` — identical.
15. `imports a CLIProxyAPI codex storage file without its envelope fields` — identical.
16. `takes the expiry from the access token so an import does not refresh at once` — identical.
17. `rejects API-key auth files and Sign in with ChatGPT records before saving` — identical.
18. `uses the SIWC authorize parameter set and reauthorizes with the issued client` — identical.
19. `exchanges with the issued client and resource and keeps sign-in without the plan scope` — identical.
20. `rejects a callback with a forged state and redacts provider error bodies` — identical.
21. `cancels the loopback at its deadline without finishing the authorization` — identical.
22. `cannot load: its server-credential module and save route are absent` — identical.
23. `lists exactly the exports the module provides` — identical.
24. `adds prompt=login, which production authorize URLs still lack` — identical.
25. `builds the form refresh both sources send, where production sends JSON` — identical.
26. `reduces device poll failures to a fixed message, where production returns the body` — identical.
27. `fails unsupported login modes before any network call` — identical.

These retain production PKCE/state/replay guards, bound workspace/account/proxy
identity, device 404 pending behavior, refresh classification/deadline signals,
model headers, executor sessions, request/stream translation, CLI import expiry
and rejection, source SIWC parameters/issued client/resource/JWKS handling and
loopback cancellation. The final five cases explicitly expose staged gaps;
they do not claim public integration.

## Reports and verification

The original report remains at `provider-signin-codex-parity.md`; the exchange
report is preserved separately at `provider-signin-codex-exchange-parity.md`.
Those source comparisons use the same documented CPA/Easy/Omni pins; this
restoration did not fetch moving sources or reclassify their contracts.

Both suites passed together: **27 + 23 = 50**, no failures or skips. The collection
failure in the historical gate did not reproduce. JSON and text evidence is in
`/var/tmp/codex-restore-2034/reports/restore-initial.{json,log}`. Dependency installs
were necessary for these tests and used a private store, HOME, DATA_DIR, TMPDIR,
XDG cache and npm cache under that directory, umask 077 and `env -i` with explicit
PATH/LANG/CI/paths. Commands have a 300-second limit; Vitest uses two workers.
No live accounts, inherited credentials, full CI, browser, Docker or network
provider calls were used. The global failure baseline and existing suites are
unchanged. This focused run does not establish full-tree regression status.

## Preserved exchange testcase names

The following 23 expanded cases retain their original protocol/security assertions.
Only the final manifest-only assertion changes as explained above.

1. `accepts printable workspace workspace-x` — preserved.
2. `accepts printable workspace workspace-01` — preserved.
3. `accepts printable workspace fff` — preserved.
4. `accepts printable workspace team\name` — preserved.
5. `rejects malformed workspace "team\u0000id"` — preserved.
6. `rejects malformed workspace "team\u001fid"` — preserved.
7. `rejects malformed workspace "teamid"` — preserved.
8. `rejects malformed workspace "team\nid"` — preserved.
9. `rejects malformed workspace 123` — preserved.
10. `rejects malformed workspace " "` — preserved.
11. `rejects conflicting selectors and a token for another account` — preserved.
12. `keeps two imported account credentials separate and strips the unrelated API key` — preserved.
13. `preserves concurrent client, verifier and proxy identity with one submission each` — preserved.
14. `rejects HTTP 400 without reading or exposing a body or resubmitting` — preserved.
15. `rejects HTTP 401 without reading or exposing a body or resubmitting` — preserved.
16. `rejects HTTP 403 without reading or exposing a body or resubmitting` — preserved.
17. `rejects HTTP 429 without reading or exposing a body or resubmitting` — preserved.
18. `rejects HTTP 500 without reading or exposing a body or resubmitting` — preserved.
19. `rejects missing PKCE before transport and scrubs malformed accepted responses` — preserved.
20. `forwards caller cancellation without retrying a submitted code` — preserved.
21. `rejects expired authorization before transport using a fake clock` — preserved.
22. `uses the account's issued client on refresh and suppresses rejected token contents` — preserved.
23. `records the existing exchange slot and preserves centralized flow ownership` — preserved.

Related regressions: eight unchanged files, **80 passed**, no failures or skips.
Evidence: `/var/tmp/codex-restore-2034/reports/regressions.{json,log}`.

Scoped ESLint on both changed production JavaScript files and `git diff --check`
passed. No full-tree gate was requested or run.
