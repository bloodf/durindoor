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

Chunk-capable capture enumerates the provider root URL in the confirmed tab's store, checks
names before values, and fails closed beyond the existing 64-entry enumeration ceiling.
Canonical numeric indices must be unique, contiguous from zero and below the existing 16-cookie
ceiling. Invalid or excessive chunk values and an import body beyond the endpoint's 32 KiB
ceiling fail before POST. Unrelated cookie values are ignored. Complete chunks supersede a stale
whole cookie under the existing shared contract; the canonical ordered chunks alone are sent.
Fixed-name providers retain their exact-name reads; hashed families retain their existing rule.
The popup permissions, provider allowlist, pairing authority and destination checks stay intact.
Browser APIs supply the URL-scoped cookie set; enumeration is a snapshot, not an atomic browser
session lock. This does not prove a provider accepts a captured credential.

HAR extraction checks explicit domain and RFC-style path matching against the request URL,
secure metadata, and recognized `expires` (date string or Unix seconds), `expirationDate` and
`expiry` (Unix seconds). Every explicit expiry must be finite, fresh and valid. Multiple expiry
fields use the earliest value. A duplicate structured cookie, mismatched repeated header, or
invalid metadata refuses that request entry instead of letting a header erase the evidence.
Fresh expiry survives into the import request and is checked again before candidate selection.
Session cookies with no expiry remain supported. Other valid HAR entries can still be offered.
Unknown exporter metadata is not interpreted. Conservatively rejecting an entry can also reject
one with an expired unrelated structured cookie.

Raw Cookie headers have no verifiable origin, scope or expiry. cURL and header-only HAR supply
a request origin but no per-cookie expiry/domain/path proof. They remain supported without
invented expiry. The parser neither executes cURL nor contacts any URL from input.

## Validation

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
immutable suites to exercise the new capture boundary. This patch is **not a passing full gate**.

Full local CI, build and independent review have not been run. No push or merge was performed.

Retry note: the test and this report were renamed from `cookie-chunk-har-integrity-2034.*` to the
required `fix-cookie-chunks-har-expiry-2034.*` paths with no case or product change. The renamed
focused file was not re-run locally in this checkout because it has no installed dependencies;
the native gate supplies the isolated setup.
