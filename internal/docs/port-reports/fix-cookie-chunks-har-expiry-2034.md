# Capture chunk integrity and HAR expiry (#2034)

Base: `fbf30334f2dc4899e900a215252e3e020b4cbe2f`. No post-freeze head adopted.
Only capture.js, cookieImportParser.js, the new regression test and this report change.
No upstream logic ported; the implementation uses this project's existing contract and bounds.

## Preserved synthetic source reproductions

From `cookie-flows/chatgpt-web-codex-2034.md`, defect 2:

```js
const harness = fakeChrome({ "tab-profile": jarOf(
  jarCookie(`${SESSION}.0`, chunk("alpha", 0)),
  jarCookie(`${SESSION}.2`, chunk("alpha", 2)),
) });
const { result } = await captureWith(await mintPairing({ action: "create", name: "gap" }), harness);
// Observed: result.ok === true, result.cookieCount === 1; the stored header is chunk .0 only.
// Names read: the base name, .0 and .1.
```

From `cookie-flows/grok-web-2034.md`, gap 2:

```sh
d=$(mktemp -d)
cat > "$d/hook.mjs" <<'EOF'
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) { if (s.startsWith(".")) return next(`${s}.js`, c); throw e; } } });
EOF
cat > "$d/probe.mjs" <<'EOF'
const { parseHarDocument, buildImportCandidates } = await import(`${process.argv[2]}/src/shared/utils/cookieImportParser.js`);
const contract = { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] };
const har = { log: { entries: [{ request: { url: "https://grok.com/rest/app-chat/conversations", headers: [],
  cookies: [{ name: "sso", value: "synthetic-stale", expires: "2001-01-01T00:00:00.000Z" }] } }] } };
console.log(JSON.stringify(buildImportCandidates({ kind: "har", parsed: parseHarDocument(JSON.stringify(har)) }, contract).candidates[0].cookies));
EOF
node --import "$d/hook.mjs" "$d/probe.mjs" "$PWD"
```

The private source-only probe reproduced both outcomes against the base sources: a `.0`/`.2`
jar reported success with only `.0` submitted; the 2001 HAR cookie became an offered candidate
without expiry. These are synthetic offline observations, not evidence about live cookies.

## Behavior and limits

**The chunk-hole reproduction is not fixed in the extension.** The first attempt enumerated the
provider jar with `cookies.getAll` to find holes, duplicates and hidden tails. Existing tests that
must not change (`cookie-flow-chatgpt-web-2034`, `cookie-flow-chatgpt-web-codex-2034` and
`provider-cookie-capture-extension`) pin the shared capture contract: chunked families use exact-name
reads only, `cookies.getAll` is forbidden, probing stops at the first gap (a `.0`, `.1`, `.3` jar
submits `.0` and `.1`), and the 16-cookie ceiling truncates instead of refusing. The gate failed
on that enumeration, so it was removed. Under exact-name reads a chunk after a gap is never read,
so the extension cannot tell `.0`+`.2` apart from a complete single `.0`. The new test now states
this limit as a passing assertion: the `.0`+`.2` jar submits only `.0`, and `.2` never leaves the
browser. Refusing the hole needs a server-side import-contract rule (under `src/lib/**`, out of
scope) or an approved change to the capture contract and its tests.

What capture now enforces before any POST, within that contract: every approved value must be
at most 8192 characters of printable ASCII with no `;` and no leading or trailing whitespace,
and the import body must fit the endpoint's 32 KiB ceiling. Noncanonical names such as `.00`, `.-1`,
`.16` or huge indices are never requested, so they cannot be captured. Unrelated cookies, store
binding, origin checks, the permission flow and hashed-family enumeration are unchanged.

HAR extraction checks explicit domain and RFC-style path matching against the request URL,
secure metadata, and recognized `expires` (date string or Unix seconds), `expirationDate` and
`expiry` (Unix seconds). Every explicit expiry must be finite, fresh and valid. Multiple expiry
fields use the earliest value. A duplicate structured cookie, mismatched repeated header, or
invalid metadata refuses that request entry instead of letting a header erase the evidence.
`parseHarDocument` keeps its public entry shape (`{ name, value }` cookies; an entry with stale
metadata is still listed), which an existing claude-web test pins. The scope and expiry evidence
is held in a module-private `WeakMap` keyed by entry object. `buildImportCandidates` refuses
flagged entries and forwards fresh expiry as `expirationDate`, which is checked again before
candidate selection. An entry built or cloned outside `parseHarDocument` carries no evidence and
is treated like a raw Cookie header. The dashboard passes the parser's own result directly.
Session cookies with no expiry remain supported. Other valid HAR entries can still be offered.
Unknown exporter metadata is not interpreted. Conservatively rejecting an entry can also reject
one with an expired unrelated structured cookie.

Raw Cookie headers have no verifiable origin, scope or expiry. cURL and header-only HAR supply
a request origin but no per-cookie expiry/domain/path proof. They remain supported without
invented expiry. The parser neither executes cURL nor contacts any URL from input.

## Validation

Retry run (current head): private archive `/var/tmp/durindoor-chunks-retry.DKTMtw` of the tracked
worktree files, frozen-lockfile root and tests installs with a private store, `env -i` with
explicit PATH/LANG/CI and private HOME/DATA_DIR/TMPDIR, 300-second ceiling, two workers.
`better-sqlite3` was rebuilt inside that archive. Results:

- `unit/fix-cookie-chunks-har-expiry-2034.test.js`: 18 passed.
- Every unit file that references `capture.js`, `cookieImportParser` or `parseHarDocument`
  (40 files, including the three capture-contract suites that failed the gate and
  `cookie-flow-claude-web-2034`): 1058 passed, 0 failed.
- ESLint on the three changed source/test files: clean.

The full `test:ci` suite, build and independent review were not run locally.

Earlier attempt, kept for history:

Private directory: `/var/tmp/durindoor-integrity-2034.aK0tvh`. A tracked-source archive of the
frozen base received only this patch. Root, CLI and tests frozen-lockfile installs succeeded in
that owned archive with a private dependency store. No shared dependency graph was modified.
Commands use `env -i`, explicit PATH/LANG/CI, private HOME/DATA_DIR/TMPDIR/cache/store and a
300-second ceiling; focused Vitest uses at most two workers. No real provider, browser, Docker,
production service, credential or user data directory was used.

The dependency-free actual-source probe passed 21 checks, including both before-fix reproductions,
post-fix gap/duplicate/index/value/count/body refusals, whole/contiguous success, HAR expiry/scope
refusals and session/fresh HAR acceptance. Its scripts are retained in the private directory.

The new `tests/unit/fix-cookie-chunks-har-expiry-2034.test.js` exercises actual capture and parsers,
authenticated one-use pairing/import handlers and private on-disk SQLite. Only browser/network
boundaries and operator authority are mocked; origin checks and import core remain real.
Initial test setup lacked the Host header required by the real origin guard and returned 403;
the new harness was corrected. Existing tests remain immutable.

Final focused command (from the private archive's `tests/`, same isolated environment):

```sh
timeout 300 node node_modules/vitest/vitest.mjs run \
  unit/fix-cookie-chunks-har-expiry-2034.test.js \
  unit/provider-cookie-import-contracts.test.js \
  unit/provider-cookie-import-dashboard.test.js \
  unit/cookie-flow-grok-web-2034.test.js --maxWorkers=2 \
  --reporter=json --outputFile=/var/tmp/durindoor-integrity-2034.aK0tvh/final-focused.json
```

Final focused result: **132 tests passed across four files**. Evidence: `final-focused.json`
and `final-focused.log` in the private directory above.

The new suite has 20 passing tests, including pairing authorization/replay refusal, redacted
responses/logs, body/enumeration ceilings, account isolation and blocked partial updates.
Root `pnpm run lint` passed: zero errors, 348 existing warnings; anti-slop passed with zero
diagnostics across 3694 files. `git diff --check` passed.

Compatibility run of the unchanged `provider-cookie-capture-extension.test.js` and
`cookie-flow-chatgpt-web-codex-2034.test.js`: **164 passed, 9 failed**. Evidence:
`/var/tmp/durindoor-integrity-2034.aK0tvh/compat.json` and `compat.log`.
Their fake browsers forbid or do not supply the newly required enumeration. The affected
assertions cover contiguous reads, the cookie ceiling, four chunk-capable providers in the
exact-name-only matrix, and three Codex capture/error cases. Their legitimate fixtures were
not converted into failure fixtures, and no test or baseline was changed to hide these failures.
The stricter implementation cannot establish duplicate/invalid-index absence through exact-name
reads alone. A future explicitly authorized assertion/harness migration is required for those
immutable suites to exercise that boundary. That attempt was **not a passing gate**; see the retry above.

Full local CI, build and independent review have not been run. No push or merge was performed.

Rename note: the test and this report were renamed from `cookie-chunk-har-integrity-2034.*` to
the required `fix-cookie-chunks-har-expiry-2034.*` paths.
