# Retained Gemini regression scenarios — #2034

Base: `d62248bead6501d33855d07cf1c76c3ad801a1e5`. Compared the complete 220-line
suite at `dd3a3fbcf17e3abc2e12b20ed5c419c5dd1e9ae0` with the integrated 359-line
suite from `4b1737339975876d3b9c01cf5b41d13da14a4749`.
The integrated suite remains byte-identical: Git blob
`97c81689d7070fe4296bf6e0dfb76a05e34de252`.
The separate `tests/unit/cpa-gemini-replay-retained.test.js` retains every earlier
valid scenario, including overlapping ones to make omissions auditable. It has
29 cases: the original 28 expansions plus a nameless ID-reservation variant.

## Primary sources and API adaptations

Read the existing source cache at project `.orq/orders/upstream-source-cache-2034/cli`,
whose HEAD is immutable CPA `dbe641f286a489ecb39e3c041c554371e6add864`.
Attribution: router-for-me/CLIProxyAPI contributors, MIT. No clone or live account.

- `internal/translator/gemini/gemini/gemini_gemini_request.go`, from
  `13e06420967b8d1762c7422d689583a1d3b6c6a0`: lines 162 and 223 separate grouping
  from empty-name backfill; lines 578–647 reserve exact ID/name and ID matches
  before name/empty-name slots. Lines 667–668 and 751 explain preservation for
  downstream pairing rejection. Therefore grouping uses the current exported
  `groupGeminiFunctionResponses` in `formats/gemini.js`; name backfill is asserted
  on the real route, and rejection is asserted on the real route before dispatch,
  replacing the absent earlier private `concerns/geminiReplay.js` API.
- `internal/util/gemini_schema.go`, from
  `54ed2ba2016642abd897456f48d84b9f0fee6632`, supplies the Gemini-only empty/null/
  whitespace enum contract; direct translators and OpenAI noninterference remain
  independently asserted.
- `sdk/api/handlers/gemini/gemini_handlers.go` and
  `gemini_handlers_stream_error_test.go`, from
  `249ea68d71857bcdbca41f65d5d9bc4ed9db96ee`: the reader at lines 217–240 and the
  non-SSE trailing-error assertions at 343–363 require a raw Google RPC object,
  rather than the earlier candidate's stale `data:` error expectation. Both
  terminal reasons assert one 502 UNAVAILABLE object, no DONE and one execution.
  The message follows `internal/runtime/executor/helps/gemini_zero_output.go`.
  The current `googleRpcErrorBody` helper accepts an inner error object or envelope
  text; the retained OpenAI helper case uses that documented input contract.
- `internal/translator/antigravity/gemini/antigravity_request_format.go`, including
  `66f3ad17c6bb6c3ead080b3d10388fbe47074fe8`, optimizes a lone-string `result` to
  `output` rewrite (lines 69–146). DurinDoor deliberately does not use that step:
  `open-sse/translator/request/openai-to-gemini.js:122` documents upstream #5529's
  `wrapFunctionResult`, covered by the unchanged
  `tests/unit/gemini-function-response-wrap-port.test.js`. The two old rewrite
  rows are replaced with source-backed preservation checks, not restored.

## Every earlier scenario compared

Numbers count expanded `it.each` rows in the earlier suite. Integrated coverage
below identifies concrete assertions, not just a similar test title. Retained
coverage uses the earlier titles except for the corrected payload expectation.

| Old cases | Earlier contract | Concrete integrated 17 coverage | Separate retained assertion |
| --- | --- | --- | --- |
| 1 | Split order, function role, blank-name backfill, signatures/IDs, input | Grouping checks order/function role; executor test only checks a truthy signature, no blank name | Ordered a/b IDs; real route backfills first/second and retains both exact signatures; deep source snapshot |
| 2 | Whitespace enum in a property literally named enum | Enum test preserves a property named enum, but it has no enum array | Literal enum property's array drops null/empty/whitespace and keeps spaced valid strings |
| 3 | Duplicate ID with exact names and both spellings | Placeholder x calls a/b in camelCase; separate snake-only test | Same-ID mixed snake/camel replies order first/second and route accepts |
| 4 | Mixed text and intervening user turn | Integrated interleaving checks note/mixed after replies | Extra/between text order after a/b, source unchanged |
| 5 | Null boundary | Not in integrated table | Grouping preserves whole history; route 400, zero dispatch |
| 6 | Empty parts boundary | Integrated empty boundary remains same array | Same preservation plus route rejection |
| 7 | Missing parts boundary | Not present | Same preservation plus route rejection |
| 8 | Object-shaped parts boundary | Not present | Same preservation plus route rejection |
| 9 | Call-bearing user boundary | Integrated boundary remains same array | Same preservation plus route rejection |
| 10 | Zero replies | Integrated has one of two replies only | Zero results retained; route rejects without dispatch |
| 11 | One of two replies | Integrated incomplete same-array assertion | One result retained; route rejects without dispatch |
| 12 | Three replies for two calls | Integrated excess helper uses one call and two replies | All three retained; route rejects without dispatch |
| 13 | Wrong explicit reply ID | No corresponding assertion | Both results retained; route rejects without dispatch |
| 14 | Wrong reply name | Integrated unmatched helper only checks appended order | Both results retained; route rejects without dispatch |
| 15 | MALFORMED after thought, no replay | Exact raw RPC 502 and one execution | Raw error, thought text survives, no DONE, one execution |
| 16 | UNEXPECTED after thought, no replay | No corresponding terminal reason | Same raw RPC and no-replay guarantees |
| 17 | Safe RPC details and credential redaction | ErrorInfo reason and message-token redaction | RetryInfo retryDelay survives; token in message and access_token detail is absent; one execution |
| 18 | OpenAI and plain text RPC normalization | String-code object and plain text 504 | rate_limit object with 429 fallback and plain text 503 exact canonical bodies |
| 19 | Incomplete native route rejected before dispatch | No rejection route assertion | 400 INVALID_ARGUMENT and zero execution |
| 20 | Real native split snake/camel IDs and signatures | Gemini route checks IDs; executor checks a truthy signature; no exact two-signature route assertion | Real Antigravity route retains a/b IDs, two exact signatures, and error result payload |
| 21 | Both direct translators plus OpenAI noninterference | Direct Claude cleanup only; schema-builder enum test | OpenAI and Claude to Gemini clean; OpenAI to OpenAI retains exact schema; source bodies unchanged |
| 22–23 | Camel/snake response payload variants | No payload-preservation assertion | Each spelling preserves single string result, nested result, result with sibling, existing output, nested output, result+output, array and null; entire input unchanged |
| 24 | Native translation input nonmutation | No deep input snapshot | Real same-format translateRequest leaves body identical |
| 25 | ID reservation, explicit consumption | Nameless idless positional route only | Explicit result reserved ahead of idless same-name or nameless slot; bridge consumes explicit one before assigning idless two |
| 26 | Separate excess response turns | Helper appends unmatched reply only | Both results retained; grouped and original route requests both reject with no dispatch |
| 27 | Bridge OpenAI post-commit error | Real OpenAI execution error through chat core | Direct bridge stream retains started text and canonical 500 INTERNAL error |
| 28 | Snake calls normalized before signature filtering | Snake helper test does not run executor | Executor retains signed-first a and unsigned sibling b, groups a/b results; source snapshot unchanged |

## Runtime corrections and scope

Only three runtime files change. The Antigravity executor reads snake function
and signature keys before thought filtering. The bridge consumes explicit reply
slots and carries provider signatures using the existing signature-transport ID
codec on the public route. Direct helper callers retain plain IDs by default,
preserving the existing tool-calling regression. The route rejects corrupt native
pairing before conversion can erase boundaries or auto-repair missing replies.
A later model call starts a fresh queue, preserving #1089's unanswered-earlier-turn
contract. Root `chatCore.js`, current 17 tests and all existing regressions are untouched.

## Verification

Dependency installation and test/lint commands completed within five minutes, using private `/var/tmp/gemini-retain-2034`
HOME, DATA_DIR, TMPDIR, XDG and npm/pnpm storage, `env -i` and
umask 077. Root, CLI and test dependencies were installed with frozen lockfiles
and prefer-offline. No inherited provider/publisher credentials, full suite,
live account, browser, Docker or deployment was used. CodeGraph was unavailable
in the isolated environment; bounded exact-file reads supplied source evidence.

The first retained comparison exposed 18 failures while the integrated 17 stayed
green. After corrections, the original retained 28 and integrated 17 plus nine
existing gateway conformance cases passed (54). Adding the nameless variant and
expanded preservation cases exposed an existing direct-helper plain-ID contract;
signature transport is now explicitly enabled only by the public gateway.

Final result: **18 files, 203 tests passed**, including the unchanged integrated 17
and all 29 retained cases. The final focused rerun passed all 46 cases after
the role-constant cleanup. Targeted ESLint and root `pnpm run lint` passed; root
lint reported 349 existing warnings and zero errors, and anti-slop had zero diagnostics.

Final scoped command: from `tests/`, `node node_modules/vitest/vitest.mjs run`
with these explicit files and `--maxWorkers=2`:

- `unit/cpa-gemini-replay-parity.test.js`, `unit/cpa-gemini-replay-retained.test.js`
- `unit/v1beta-gemini-gateway-conformance-1089.test.js`, `unit/v1beta-gemini-tool-calling.test.js`, `unit/v1beta-gemini-inline-data.test.js`
- `unit/gemini-function-response-wrap-port.test.js`, `unit/gemini-tool-response-sanitization.test.js`
- `unit/gemini-tool-enum-sanitization-4973.test.js`, `unit/omni-gemini-numeric-enum-contract.test.js`
- `unit/antigravity-gemini-native-response.test.js`, `unit/antigravity-partial-output-no-replay-2034.test.js`, `unit/antigravity-partial-output-helper-2034.test.js`
- `unit/empty-stream-guard.test.js`, `unit/antigravity-trailing-stream-error.test.js`, `unit/antigravity-thought-signature-family.test.js`
- `unit/antigravity-cpa-request-envelope.test.js`, `unit/antigravity-payload-limits.test.js`, `unit/gemini-native-endpoint.test.js`

Raw install, initial comparison, retry, scoped regression and lint logs are private
under `/var/tmp/gemini-retain-2034/`. This is scoped evidence, not a full merge gate.
No failure baseline entries were added. Commitlint uses the local-CI pinned
CLI 18.6.1 and conventional config 18.6.3 in a private tool directory.
