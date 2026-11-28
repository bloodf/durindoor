# Muse Spark Web session lifecycle — #2034

**Verdict: FIXED for the mocked contracts.** Five defects are fixed, each with its own regression. They are the
refusal status, rotation write-back, bare-value and header-shape handling, and replay after an unknown outcome. Live
behaviour is still unverified. That covers whether Meta rotates `ecto_1_sess`, what real session values look like, and
whether a live browser applies the proxy.

Base: `046795ee95f3ab93e18c6c48da846568bce57c0a`. The executor is ported from OmniRoute
`4265bb2ad5477450a07d3a43ea33a62c6c874878` (MIT). Everything below is DurinDoor code, not a port of later upstream
work. Earlier reports: `cookie-flows/muse-spark-web-2034.md` and `fix-muse-browser-proxy-isolation-2034.md`.

## Changed files

| File | Change |
| --- | --- |
| `open-sse/executors/muse-spark-web.js` | Muse-only cookie normalization, selection provenance, refusal mapping, rotation hand-off, outcome-unknown marking |
| `open-sse/executors/muse-spark-web/fresh-access-token.js` | `rotationPersistable` flag from the structured `Set-Cookie` list, carried through the token cache |
| `tests/unit/complete-muse-session-lifecycle-2034.test.js` | New suite, 26 cases (with `it.each` rows) |
| `tests/unit/cookie-flow-muse-spark-web-2034.test.js` | Two defect-pinning cases migrated to stricter post-fix assertions (see below) |
| `tests/unit/fix-muse-browser-proxy-isolation-2034.test.js` | One defect-pinning assertion migrated (502 → 503 plus the category) |

I did not touch `src/**`, the shared `websession-utils.js`, `accountFallback.js`, the dispatcher, or any provider,
config or baseline file. Persistence uses the dispatcher's existing callback, and the executor writes nothing to the
database.

## Defects and fixes

### 1. Route refusal reported as a bootstrap failure

The token refresh already returned `{ ok: false, status: 503, refused: true }` for a relay, a strict route with no
usable proxy, a scheme the browser cannot apply, an engine without verified proxy support, or an exceeded refresh
bound. `runChat` mapped every non-OK refresh to 502 `"Meta AI token bootstrap failed"` / `meta_ai_auth_error`.

The fix answers a refusal with 503, `error.type: "unsupported"` and `error.code: "meta_ai_refresh_unsupported"`. The
message says the session was not verified. It is not 401, so the account is never marked expired or invalid. It is not
2xx, so the account is never marked healthy. Through the real gateway the row ends `testStatus: "unavailable"` and
`errorCode: 503`, with a short model lock and `lastError` that carries the refusal code. That is the gateway's existing
handling of any 503, and I did not change it. Inside that lock window the client gets the gateway's own 503
"Provider unavailable". The guard is unchanged: without `enableSessionDispatch === true` it still answers 501. For
relays and unsupported engines the refusal still happens before the cookie is placed in a browser. For relays it also
happens before the bootstrap fetch.

### 2. Bootstrap cookie rotation used for one turn only

A rotated `ecto_1_sess` from the bootstrap `Set-Cookie` drove the rest of the turn and was then lost. Now
`persistRotatedCookie` hands it to `input.onCredentialsRefreshed`. chatCore already passes that callback to every
executor. For a non-OAuth connection the single-model dispatcher writes `rotatedApiKey` through
`updateProviderCredentials`, using `expectedRefreshContext`. That compare-and-set checks the connection id, provider,
auth type and the exact `apiKey` that was sent. A stale writer is therefore refused:

- a cookie re-imported while the rotating turn was in flight is kept;
- a second rotation sent with the same, now-superseded session is refused (`writes: [true, false]`);
- a rotation only ever targets the connection that sent the cookie; the sibling account and its proxy are unchanged.

Guards added before the hand-off:

- Only the primary `apiKey` is written back. A cookie taken from `extraApiKeys` is never written back.
- `rotationPersistable` is true only when `Headers.getSetCookie()` holds exactly one non-empty `ecto_1_sess`, with no
  `Max-Age` at or below zero and no past `Expires`. A deleting Set-Cookie never replaces a stored session. The turn
  still uses whatever the existing refresh code chose.
- The stored shape is kept. A bare stored value stays bare, unless the rotated value would not read back as bare; it
  then takes the canonical `ecto_1_sess=` form. A header has only its `ecto_1_sess` value replaced.
- A failed write is logged, with the stored cookie, the rotated cookie and their values passed to
  `sanitizeErrorMessageWithSecrets`. The turn still answers.

Limitation: if the refresh fails after a rotating bootstrap (the page step fails, for example), the rotation is not
persisted. Whether Meta invalidates the earlier value on rotation is unverified.

### 3. Bare value with "=" padding misparsed; malformed shapes sent upstream

The shared `normalizeSessionCookieHeader` treated any value containing "=" as a header. A bare value such as
`abc==` therefore had no `ecto_1_sess` and answered 401. Values with no "=" were prefixed whatever they held. That
let these reach the bootstrap transport on base:

| Input | Base | Now |
| --- | --- | --- |
| `ecto_1_sess=v\r\nX-Other: y` | sent | 401, no traffic |
| `v\nX-Other: y` | sent | 401, no traffic |
| `ecto_1_sess=v; X-Other: y` | sent | 401, no traffic |
| `Authorization: Bearer v` | sent as `ecto_1_sess=Authorization: Bearer v` | 401, no traffic |
| `v more` | sent | 401, no traffic |
| `abra_sess=v`, `abc=defv`, `ecto_1_sess=` | 401 | 401, no traffic |
| `v==` (bare, trailing padding) | 401 | `ecto_1_sess=v==`, sent through the account proxy |

The Muse-only `normalizeMetaAiCookieHeader` accepts two shapes. One is a header, optionally prefixed `Cookie:`, that
holds an `ecto_1_sess` pair and has only well-formed RFC 6265 pairs. The other is a bare value made of cookie octets,
with "=" allowed only as trailing padding. It refuses everything else, including control characters inside the value.
It assumes no other cookie name and invents no format. A malformed primary credential is refused. It does not fall
through to an extra key, which matches base. The shared helper is unchanged. Whether real session values carry "="
padding is unverified. The base CR/LF rows were seen at the mocked transport. I make no claim about what undici
would have put on the wire.

### 4. Unknown work replayed on a sibling account

If the WebSocket closed abnormally after the prompt frame was sent, the executor returned an ordinary 502. The gateway
then re-ran the whole turn on the next account, sending the prompt a second time. Now `wsChat` reports
`promptSent`. A 502-class WebSocket failure or an empty reply after that point uses the repository's existing
never-replay contract. It sets `claudeRequestScoped: true` on the result and `upstreamPartialOutput` on the response,
code `meta_ai_outcome_unknown`. The message says the prompt was not retried. No sibling account, transient replay or
account cooldown follows. Failures before the prompt frame, and 401 or 429 failures, keep their ordinary handling.

## Test migrations

The brief allows only stricter post-fix migrations of existing tests. None was skipped or deleted.

- `cookie-flow-muse-spark-web-2034.test.js`, padded bare value. It was `401` plus `nothingSent()`. It is now `200`, with
  three GraphQL sends, the browser cookie and the WebSocket all on the account's proxy (`PROXY_B`), no direct send and
  the stored value unchanged. That test's fake page builds its token from the cookie and cannot carry "=", so it gets
  a local copy of the shared pool fake that strips the padding.
- Same file, rotation. It was "stored value stays `COOKIE_A`". It now expects `COOKIE_NEW` stored, and a second turn
  whose three sends carry `COOKIE_NEW`.
- `fix-muse-browser-proxy-isolation-2034.test.js`, refused relay. It was `502`. It is now `503` with
  `{ type: "unsupported", code: "meta_ai_refresh_unsupported" }`. The no-traffic and no-acquire assertions are kept.

The guard suites (`muse-spark-web-guarded-dispatch`, `websession-dispatch-gate`, `omniroute-websession-*`) are
unchanged.

## Evidence

Everything here is mocked. Real: the registry, the provider routes, isolated SQLite, credential selection,
`handleChat`, the `/v1/messages` route, chatCore, the dispatcher's guarded write-back, the executor, the token refresh
and proxy routing. Mocked: the management guard, the physical transport behind the proxy router (identity
dispatchers), the browser pool and the WebSocket. Every credential and proxy is synthetic. No browser, provider, proxy,
relay or Meta endpoint was contacted.

| Requirement | Test (`complete-muse-session-lifecycle-2034.test.js`) |
| --- | --- |
| Buffered and streamed OpenAI Chat Completions and Anthropic Messages through the account proxy | `serves buffered and streamed …` |
| Guard stays 501 with no traffic on every client path | `keeps a guarded connection on 501 …` |
| Relay pool, strict pool bypassed by `noProxy`, unappliable scheme: 503 unsupported, no traffic, row neither invalid nor healthy | `route refusal …` (3 rows) |
| Engine without proxy support: refused before cookie placement | `refuses a proxied refresh on an engine …` |
| Executor-level category; proxy and relay credentials absent | `carries the refusal category …` |
| Rotation persisted for the selected account only; next turn uses it | `persists a rotated header cookie …` |
| Bare shape kept | `keeps a bare stored value bare …` |
| Re-import during the turn not overwritten | `does not overwrite a cookie re-imported …` |
| Stale second rotation refused by compare-and-set | `lets only the first of two rotations …` |
| Deleting Set-Cookie never written | `never writes back a deleting Set-Cookie` (2 rows) |
| Write failure logged without secrets | `logs a failed write-back …` |
| `extraApiKeys` rotation not written | `does not write back a rotation of a cookie taken from extraApiKeys` |
| Padded bare value named and routed | `names a bare value with trailing = padding …` |
| Header shapes kept as written | `keeps known header shapes as written` |
| CR/LF, foreign header and malformed shapes refused before traffic, without extra-key fallthrough | `refuses … with 401 before any traffic` (8 rows) |
| No replay after the prompt frame, even with a second account | `does not retry a turn whose WebSocket failed …` |
| No cookie, rotated value or proxy or relay secret in responses or console output | `expectNoSecrets` in each case |

On the base executor, 20 of the 26 cases fail. The 6 that pass pin behaviour that was already correct. They are the
gateway client paths, the guard, the two deleting-Set-Cookie rows, and the `extraApiKeys` case.

Commands. Each ran under `env -i` with an explicit `PATH`, `LANG` and `CI`, and a private `/var/tmp` `HOME`,
`DATA_DIR`, `TMPDIR`, cache and pnpm store. No credentials were present, and every command had a 300 s ceiling.

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/complete-muse-session-lifecycle-2034.test.js unit/cookie-flow-muse-spark-web-2034.test.js \
  unit/fix-muse-browser-proxy-isolation-2034.test.js unit/muse-spark-web-browser-dispatch.test.js \
  unit/muse-spark-web-guarded-dispatch.test.js unit/muse-spark-web-signin-parity.test.js \
  unit/omniroute-websession-blocked.test.js unit/omniroute-websession-runtime.test.js \
  unit/provider-cookie-lifecycle-muse-yuanbao-hugging.test.js unit/review-b-websession-wiring.test.js \
  unit/review-w-muse-spark.test.js unit/review-w-websession-proxy.test.js unit/review-x-executor-send-5.test.js \
  unit/review-x-executor-send-6.test.js unit/review-x-sse-final.test.js unit/websession-dispatch-gate.test.js \
  unit/web-session-redirects.test.js unit/provider-cookie-import-contracts.test.js
node node_modules/eslint/bin/eslint.js src
node scripts/build-anti-slop-plugin.mjs
node scripts/check-anti-slop.mjs
```

Results: 18 files and 628 tests passed, on two consecutive runs. ESLint reported 0 errors; its warnings are
pre-existing and all in `src/`, which this change does not touch. Anti-slop reported 0 diagnostics, and the generated
bundle was unchanged. I did not run the full inventory, `test:ci`, the build, e2e or any live provider test.
