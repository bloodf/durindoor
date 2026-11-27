# Register auth batch 2 (#2034)

Status: implementation and required mocked coverage complete. Pending the
external Qwen Cloud regional handoff noted below.

Prepared base: `8f4fc37ee7`. This retry carries every change and test from the
blocked checkpoint `969c75c2b4` and completes its remaining items.

## Changes

### From the checkpoint (kept)

- **Qwen OAuth (`qwen` / `qw`):** uses the staged device handler
  `src/lib/oauth/providerParity/qwen/index.js` through the existing provider
  table. The shared flow still owns PKCE, claims, state, proxy selection and
  persistence. Qwen Cloud API keys (`qwc`) are unchanged.
- **iFlow:** the existing cookie route calls the staged `importIflowCookie`
  helper and forwards cancellation. Responses carry no key prefix and no
  upstream error body. OAuth exchange and profile failures return fixed
  messages.
- **Kiro:** registration uses `buildKiroRegistration`. The Builder ID/IDC
  distinction, region, organization start URL and selected proxy are kept.
- **Public GitHub:** device polling uses `decodeCopilotPollResponse`, which
  keeps only known protocol fields from untrusted bodies.
- **GHE:**
  - Refresh, discovery and validation use the staged connection binding.
  - The executor no longer forwards the long-lived OAuth token for rows that
    have only an API URL.
- **Copilot background refresh:** both writes (OAuth grant and session
  exchange) are compare-and-swap writes under the existing writer lock. Each
  one compares the sending credentials, the provider metadata and the row
  revision.

### Completed in this retry

- **Proxy route identity** (`open-sse/executors/gheBindingInput.js`).
  - **Problem:** the staged binding compares the sign-in proxy options with
    the caller's options structurally. Every caller resolves the same saved
    pool into a differently shaped object: dispatch, discovery, validation and
    the background scheduler each use their own shape. So every proxied
    enterprise connection failed with `reauthentication_needed` after
    sign-in. The public-route test found this.
  - **Fix:** `gheSelectedProxy` compares only the fields that choose the
    egress route: proxy URL, no-proxy list, relay URL, environment-proxy
    bypass and strict mode.
    - When the route matches, the sign-in options are handed to the binding.
    - When it differs, the caller's options are returned unchanged and the
      binding refuses the request.
  - **Where it is used:** the executor (`execute`, `fetchProviderRequest`,
    `refreshCredentials`), the `"ghe-copilot"` refresh handler, discovery and
    validation.
- **Background proxy resolution** (`src/sse/services/tokenRefresh.js`). The
  scheduler passes no proxy options. For `ghe-copilot`, `checkAndRefreshToken`
  now resolves the saved pool with the existing `resolveConnectionProxyConfig`.
  If a strict pool is unavailable, it resolves to a failed route, and the
  binding refuses the refresh rather than sending it directly.
- **Session expiry format** (`withSessionExpiry`). The shared request-path
  writer stores `copilotTokenExpiresAt` as ISO text, but the binding requires
  epoch seconds. So every enterprise row failed after its first request-path
  refresh. Dispatch and discovery now convert the stored value to seconds.
  Malformed values stay malformed (`NaN`), and the binding still rejects
  missing tokens and past expiries.
- **Request-path provenance** (`src/shared/services/providerCredentials.js`,
  scope expansion; see below).
  - `gheSession` is now an allowed refresh metadata field. Only its exact
    shape is accepted: `issuer`, `clientId`, `apiOrigin`, `kind` and a 64-hex
    `tokenHash`.
  - Without this, a re-minted session's digest was never stored, and the next
    request failed the provenance check.
  - A re-mint that names no API clears the old `copilotApiUrl` for
    `ghe-copilot`, so the API origin matches the new provenance.
- **Unknown session expiry** (`GheCopilotExecutor`).
  - `needsRefresh` re-mints a session that states no expiry on its bound
    issuer before use.
  - A row without sign-in provenance (`gheBinding`) is refused if its session
    still has no expiry at dispatch, for example because the re-mint failed.
    Its age and issuing exchange are unknown.
  - Bound rows keep the staged helper's behavior. Their session digest,
    issuer, client and API origin were recorded by this gateway's own
    exchange.
  - OAuth (primary) credentials without an expiry are not affected.

## Legacy provenance decisions

- **API-only rows** (no `gheUrl` and no `gheBinding`) are refused before any
  network on all four paths: dispatch, discovery, validation and background
  refresh. An operator-stored API URL cannot establish the OAuth issuer, the
  issuing client or the token origin. Reconnecting with the enterprise origin
  creates a bound row.
- **Historical rows with `gheUrl`** keep their operator-entered issuer. That
  value is the explicit enterprise host the operator typed at sign-in.
  - A stored API host is used only when it is trusted for that issuer: the
    issuer itself, one of its subdomains, or a GitHub-operated Copilot host.
    Any other stored API host is ignored, and requests go to the issuer.
  - OAuth forwarding to an API peer is refused.
- **Client fallback.** For historical rows, refresh uses
  `oauthClientId || gheCopilotClientId()`. This sends the refresh grant only
  to the row's own issuer, through its bound transport (no redirects, outbound
  guard, selected proxy). A wrong client id is refused by the issuer and does
  not expose the grant to a third party. New rows record the issuing client
  in `gheBinding`.
- **Missing session expiry.** The pinned sources were not re-read for this
  retry, so this report does not claim that the source accepts an absent
  `expires_at`. Instead, the gateway never relies on an absent expiry. It
  re-mints first, and it refuses unbound rows that still lack one.

## Obsolete-contract test changes (strengthened, none removed)

| Test | Before | Now | Reason |
| --- | --- | --- | --- |
| `omni-copilot-account-contract-precedence` | GHE fixtures sent the OAuth credential to an API-only host | Fixtures name their issuer and a scoped session. A new case refuses the API-only shape before any request. A new assertion checks that each host received only its own session credential. | API-only legacy forwarding was unsafe (58b99aae07 kept it only to keep these tests green). |
| `provider-signin-copilot-parity` routing case | Dispatched a historical session with no expiry | The same row now fails `needsRefresh` and is refused before network. With a stated expiry, the original routing assertions run unchanged. | Unknown-age sessions are re-minted first. |
| `provider-signin-copilot-parity` manifest | Callsites pinned to line numbers (staging only) | Positive wiring: each slot calls its helper, and the removed paths are absent | The four slots are wired. |
| `copilot-endpoint-contract-1073` | Historical GHE fixture without expiry | Fixture states a future expiry. Assertions unchanged. | Same expiry rule. |
| `qwen-parity-pass`, `iflow-parity-pass`, `iflow-signin-parity` | Expected upstream text in errors | Expect the fixed message and the absence of upstream text | Staged handlers do not leak upstream bodies. |
| `port9r-proxy-refresh-884` | Exact unguarded update call | Requires the CAS guard and exercises current, reconnected and deleted rows | Checkpoint change, kept. |
| Kiro, Qwen and iFlow staged blocks | Staging-only | Positive wiring assertions added. Manifests unchanged. | Slots are wired. |

## Coverage

- `tests/unit/ghe-copilot-public-parity-2034.test.js`. Real SQLite, real
  public routes, a fake network observed through per-proxy dispatchers. Two
  hosts: GitHub Enterprise Server (`ghe-a.example.test`, with a subdomain API)
  and GHE.com (`tenant-b.ghe.com`, with `copilot-api.` and the issuer OAuth
  fallback). Each host uses its own strict proxy pool. Cases:
  - Device sign-in: pending, success, denial, expiry, cancel, no replay.
  - Discovery, validation, and OpenAI and Anthropic requests, buffered and
    streamed.
  - Request-path re-mint with persisted provenance and no extra mint.
  - Background OAuth refresh with the bound client, and a reconnect during
    the exchange.
  - Legacy API-only refusal on all paths, and the untrusted stored API on a
    historical row.
  - Missing-expiry re-mint and OAuth-as-session refusal.
  - GET device-code (the CLI shape) refusal and discovery redirect refusal.
- `tests/unit/copilot-refresh-cas-2034.test.js`. The real background
  scheduler on real SQLite.
  - At both exchange points, a reconnect, a rotation by another refresher, a
    delete from a separate OS process, and a proxy change from that process
    never resurrect credentials or routing.
  - Two accounts stay separate.
  - Mutation check: restoring the base `tokenRefresh.js` fails 7 of 11 cases.
- `tests/unit/register-auth-02-parity.test.js`. Public provider wiring for
  Kiro, Qwen and Copilot, plus CLI reachability.

## Local evidence

Run in a private throwaway checkout and dependency graph
(`/var/tmp/durindoor-auth02-r2.qLLy9Xe8`): `umask 077`, `env -i`, private
HOME, DATA_DIR, TMPDIR, cache and store, a frozen lockfile, two workers, and
at most 300 seconds per command. The borrowed graphs were not used or changed.

- **Required five-file command:** 85/85 passed (`evidence2.log`).
- **GHE, Copilot, Qwen, iFlow and Kiro files, plus the new and lifecycle
  files:** 918/918 passed on better-sqlite3 (`final3.log`).
- **484 further files that import the changed modules:** 5 batches.
  - Three batches passed without failures.
  - The failures in the other two were environmental. `git grep` needs a
    repository, and `--ignore-scripts` skipped the better-sqlite3 native
    build. After a git snapshot and a private `pnpm rebuild better-sqlite3`,
    those files passed (119/119, plus 290/290 for the OCR staging files).
  - One real failure remained: `github-signin-parity` expected upstream text
    in a poll error. It was strengthened like the others and passes.
- **Scoped eslint and anti-slop (oxlint)** on every changed JavaScript file:
  0 errors.
- **Not run:** the full `test:ci`, browser, e2e and live tests, as the task
  required.

## CLI reachability and metadata

- The terminal CLI (`cli/src/cli/menus/providers.js`) reaches GitHub Copilot,
  Qwen Code and Kiro through the server-owned device flow
  (`/api/oauth/{provider}/device-code` and `/poll`). It reaches iFlow through
  the shared authorization flow.
- GitHub Enterprise Copilot is dashboard-only. It has no CLI menu entry, and
  the GET device-code route cannot carry `gheUrl` (only the POST body does).
  The test records this as unsupported; it does not simulate success.
- The legacy iFlow CLI service is source-inapplicable. Its missing
  server-credential module is covered by the retained unsupported-contract
  test.
- No source-required endpoint, client, scope, version or header change was
  found for these providers. Copilot keeps DurinDoor's VS Code header profile,
  an intentional difference documented in `provider-signin-copilot-parity.md`.
  Storybook surfaces are unchanged, so no hashes changed.

## Scope expansion

`src/shared/services/providerCredentials.js` is outside the listed paths. It
is the only request-path refresh writer. No existing field could carry the
session digest, so without this change, provenance-bound GHE rows could not
survive a request-path refresh. The change is limited to one validated
metadata field and one `ghe-copilot` API reset. It changes no schema and adds
no credential-manager code.

## Pending

Qwen Cloud regional discovery belongs to sync plan 102,
`2034-qwen-cloud-regional-request-discovery`. Its exact gated and reviewed
head is still pending. This batch does not claim `qwc` parity and does not
duplicate that work. Qwen OAuth (`qw`) stays separate. A test checks that the
CLI OAuth menu never maps it to Qwen Cloud.

No push, PR or merge was performed.
