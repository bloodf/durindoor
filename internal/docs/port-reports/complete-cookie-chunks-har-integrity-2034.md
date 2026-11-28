# Complete bounded chunk capture and durable HAR expiry (#2034)

Base: `e0e7abaf9d7`, which carries `186d63c8607ffb5419da437c1899fb7a524792dc`
(exact-name chunk capture, HAR evidence beside entries) and its parent `73a34f4e71a`.
The original protections come from `6ea3306beb2`. No upstream logic is ported and no
post-freeze source is used. All work is this project's own code, under the MIT license.

## What was still wrong after `186d63c`

1. **Chunk hole and overflow went undetected.** With the whole cookie missing, capture read
   `.0`, `.1`, … and stopped at the first gap. A jar with `.0` and `.2` sent `.0` alone and
   reported success. A seventeenth chunk was cut off at the ceiling without any error.
2. **HAR expiry/scope evidence lived in a `WeakMap` keyed by entry object.** Copying the
   parse result with `JSON.parse(JSON.stringify(...))` or `structuredClone` (React state, a
   saved draft) dropped the evidence, so an expired or out-of-scope request came back as a
   valid candidate without its `expirationDate`.
3. **The server accepted non-canonical chunk names.** `isApprovedCookieName` used `/^\d+$/`.
   Reproduced on the base: `buildImportedCookieHeader` accepted a lone
   `__Secure-next-auth.session-token.00` (the `.00` case in the new suite failed on the base
   sources with `expected true to be false`).

## Changes

- `extensions/provider-cookie-capture/capture.js` (`readApprovedCookies`):
  - **whole cookie present:** no change. Contiguous probe from `.0` up to the first gap or the
    16-cookie ceiling. The import contract still lets complete chunks supersede the whole copy.
  - **whole cookie missing:** exact-name `cookies.get` for `.0`…`.15` and the overflow
    sentinel `.16`, continuing past holes. An approved chunk after a hole, or any sentinel,
    returns the new `incomplete_cookies` code before any POST. Nothing is truncated without an error.
  - A cookie that is not a secure cookie of the provider host counts as absent, the same as
    before (so foreign or insecure single cookies still give `no_cookies`).
  - Still no `cookies.getAll` for chunked families. The one bounded hashed-family
    (WordPress/Veo) enumeration is unchanged. Approved names, origin, tab store, the 16-cookie
    and 8 KiB value limits, and the 32 KiB body limit are all unchanged.
- `src/shared/utils/cookieImportParser.js`: `parseHarDocument` drops a request whose explicit
  metadata is expired, malformed or out of scope (domain, path, secure) at parse time, and
  carries a validated fresh expiry on the cookie as plain `expirationDate`. The `WeakMap` is
  gone. When every request is refused, the error is "The HAR file's cookies have expired or
  carry invalid domain, path or expiry metadata." `filterCandidateCookies` checks a carried
  expiry against the clock again whenever candidates are built, so a copy whose expiry has
  passed is refused. Session cookies and raw Cookie headers carry no expiry, and none is invented.
- `src/shared/utils/cookieImportContract.js` (the explicitly approved outside path):
  `isApprovedCookieName` accepts only canonical chunk indices `0`…`15`, the range capture reads.
  No descriptor or provider-permission change.
- `extensions/provider-cookie-capture/README.md`: the "Only allowed cookies" row describes both
  chunk modes and the limit that remains.

## Test migrations (explicitly authorized, stricter only)

- `tests/unit/provider-cookie-capture-extension.test.js`: the old `.0,.1,.3` success is now
  refused with `incomplete_cookies`. The test checks no POST, revoked grants, no value in the
  result and exact reads (whole name, `.0`…`.3`). Separate cases cover legitimate contiguous
  success (reads are the whole name plus `.0`…`.16`), a real missing-whole `.0`…`.16` overflow
  refusal, and success with exactly sixteen chunks. Every case still asserts no `cookies.getAll`.
- `tests/unit/cookie-flow-claude-web-2034.test.js`: the "NOT PARITY: HAR parsing drops cookie
  expiry" assertion is now an expired-HAR refusal. That covers the parse result, a mixed
  expired + fresh HAR whose original, JSON and `structuredClone` copies offer only the fresh
  cookie with its `expirationDate`, and no stored row. The server's `Cookie is expired`
  assertion is kept.
- `tests/unit/fix-cookie-chunks-har-expiry-2034.test.js`: restores the `6ea3306` negatives that
  `186d63c` had removed: `.0`+`.2` refused, 17 chunks refused, and an update with `.0`+`.2`
  leaves the stored account unchanged. The "documents the exact-name limit" success became a
  refusal. The `6ea3306` duplicate `.0`/`.0` and 64-cookie enumeration cases are not
  restored: exact-name `cookies.get` returns one cookie per name, and chunk enumeration is
  forbidden.

## New suite

`tests/unit/complete-cookie-chunks-har-integrity-2034.test.js` (30 tests). It runs the real
extension capture, parser, pairing and import route handlers against isolated SQLite under a
temporary `HOME`/`DATA_DIR`. Outbound `fetch` throws.

- hole at `.0`, `.1` or `.15`, a lone `.16` sentinel, and 17 chunks: each gives
  `incomplete_cookies`, with no POST, no row, bounded exact reads and the pairing left unspent;
- contiguous `.0`/`.1` and all sixteen chunks import, and the stored header is exact;
  sixteen 2100-character chunks hit the 32 KiB body limit with no POST;
- whole cookie present keeps the old probe, and complete chunks supersede it in storage;
- `.00`, `.01`, `.016`, `.16`, `.99`, `.-1`, `.+1` and `. 1` are refused by the contract and the
  route; `.0` beside `.00` is refused; the 16 canonical chunks import;
- expired, malformed, null, foreign-domain, public-suffix, out-of-scope-path, relative-path
  and non-boolean-secure HAR metadata are refused at parse time;
- mixed HAR copies offer only the fresh request with its expiry; a JSON-saved candidate is
  refused once its carried expiry passes (fake `Date`);
- a session HAR and a pasted header import with no invented expiry; updating account A leaves
  account B's row unchanged;
- redaction: results, responses and every console call contain no session value or pairing
  secret.

Against the base sources, 20 of the 30 tests fail. The 10 that pass cover protections that
already existed.

## Evidence (offline, private env)

All commands ran under `env -i` with an explicit `PATH`, `LANG`, `CI=1`, a private `/var/tmp`
`HOME`/`TMPDIR`/`DATA_DIR`/store, no credentials, and a 300 s ceiling.
Dependencies come from a frozen install into this checkout's own `node_modules`.

- `vitest run --maxWorkers=2` on the 57 cookie/HAR/session files, including the new suite:
  57 files, 1154 tests, all passed.
- `node node_modules/eslint/bin/eslint.js src`: 0 errors (warnings only, all already present,
  none in changed files). `node scripts/build-anti-slop-plugin.mjs` and
  `node scripts/check-anti-slop.mjs`: OK, generated bundle unchanged.
- The full inventory, `test:ci`, local CI and checks were not run in this worker.

## Limits (honest)

- A missing **final** chunk with no higher index present looks like a complete shorter set,
  to the extension and to the server. Nothing offline can detect it.
- With the whole cookie present, chunks after a gap are still not read. The contiguous prefix
  travels, as before.
- A chunk that is not a secure cookie of the host counts as absent. If it is the last one, the
  shorter set travels (the same limit as above).
- No live provider, browser or extension store was exercised. Every claim here comes from
  synthetic offline tests.

Refs #2034
