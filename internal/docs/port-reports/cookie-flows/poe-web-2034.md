# Poe Web cookie flow (#2034)

Status: **offline public-route evidence and narrow never-replay repair — 101 focused cases pass**. All success claims use synthetic credentials and mocked external network responses. No live Poe sign-in, account, browser or provider behavior was exercised. Full local CI and independent review remain later PR qualification.

## Contract and retained evidence

The actual `poe-web` descriptor declares origin `https://www.poe.com` and only the `p-b` cookie, with no chunk prefixes, localStorage keys or web-login profile. The actual executor posts the stored cookie to `/api/gql_POST`. This is the frozen local implementation contract, not a claim that the current live GraphQL operation works. No upstream source was fetched; historical Git reads used `GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0`.

The original report first recorded missing dependencies, then a 31-case passing suite with public-route positives and seven excluded unsafe reproductions. This revision retains all 31 cases byte-for-byte and restores the seven cases from `841ed303ea6` as ordinary assertions: pinned HTTP 502; accepted malformed JSON, HTML and incomplete state; post-send reset; broken partial body; and stalled body deadline. There are no skips, expected failures, deleted cases or relaxed unsafe assertions. The report's earlier proposal to change shared post-processing is superseded by the existing request-scoped consumer described below.

`tests/unit/helpers/cookiePublicFlow2034.js` is used unchanged. It supplies real isolated SQLite, authenticated operator pairing/import, encrypted persistence, registry/executor lookup, account selection and the actual public OpenAI/Anthropic-compatible route handlers. Each imported account has its own strict proxy dispatcher. Only external network/browser boundaries and narrow operator authority are replaced. Vendor frames live in this suite and are synthetic GraphQL responses, not copies of production protocol/model fixtures. No parallel gateway harness or shared-helper extension was needed.

Preserved positive coverage includes both stored accounts pinned through OpenAI and Anthropic routes in buffered and streamed modes; exact selected cookie, origin, proxy, redirect policy, bot and request text snapshots; and connection-list, response and log redaction. Cookie header, cURL and HAR inputs each pass the real parser and issued contract, actual import endpoint, persistence and subsequent public dispatch. A raw Cookie header derives origin from pairing; it cannot independently prove origin. The descriptor does not support localStorage/chunks, and those imports are safely refused. Wrong origin, expired metadata and mismatched update targets leave stored connections unchanged. Updates affect only the paired row. HAR expiry/chunk behavior and public cookie batch work remain separate.

## Repair and stronger runtime evidence

The only product file changed is `open-sse/executors/poe-web.js`:

- Read JSON via existing `readBodyWithTimeout`, with `MAX_PROVIDER_BODY_BYTES`, `RESPONSE_BODY_TIMEOUT_MS` and caller cancellation. The existing reader cancels timed-out, oversized and aborted bodies; discarded non-success response bodies are cancelled without waiting on vendor-controlled cancellation latency.
- Return generic redacted `upstream_outcome_unknown` errors with trusted executor result metadata `claudeRequestScoped: true` for ambiguous server errors, post-send transport failures, unreadable/malformed/HTML bodies, GraphQL errors, incomplete states and empty/unusable 2xx answers. A transport AbortError without caller cancellation is ambiguous too.
- Preserve explicit 401/403/429 and refused-redirect behavior, quota admission errors, local invalid-credential refusal and caller aborts. Successful completions still use the original JSON/SSE construction.

The frozen consumer in `chatCore.js` propagates that executor metadata; `src/sse/handlers/chat/singleModel/postProcess.js` checks it before account fallback, and the existing outer retry consumer honors the response metadata. This is an existing request-scoped terminal contract, not a new universal terminal convention. No shared base, handler, registry, import path or `src/` file was changed.

Additive real client-key coverage creates and stores a separate connection-scoped API key for each imported account, enables `requireApiKey`, and sends actual authorization headers through all four public modes. Each key dispatches only its permitted account/proxy and usage records identify its stored key ID. A foreign connection's valid key, an invalid key and an absent key are refused without network calls or connection writes. Operator pairing authority remains narrowly mocked; these client-key checks exercise actual stored authorization, not the dashboard guard itself.

Further cases cover explicit 403/429 fallback in all four modes (original explicit 401 fallback retained); locally proven unsent credential refusal; ambiguous 503 cancellation without replay; malformed JSON, HTML, GraphQL errors, incomplete/empty/invalid-state JSON, post-send reset, transport abort and partial-body failure in all four modes; stalled-body deadline cancellation; caller cancellation while a body is pending; and oversized-body cancellation. Errors must have no OpenAI or Anthropic success terminals, and no partial text or credentials escape. Unpinned snapshot cases assign explicit stored priorities, because equal-priority selection does not promise insertion order.

## Validation

Private environment: `/var/tmp/poe-repair-2034.SfJoEWSv/{home,data,tmp,cache,store}`. The root dependency install initially used the separately owned `/var/tmp/poe-repair-2034-private` directories; CLI/tests installs and all test/lint commands used the unique directory above. Dependencies are real installs in this checkout, not borrowed symlinks. Installs used `--frozen-lockfile` and a private pnpm store. Commands ran with `timeout 300 env -i`, explicit PATH, LANG=C.UTF-8, CI=1, HOME, DATA_DIR, TMPDIR and XDG_CACHE_HOME, with no inherited provider/publisher credentials. Tests used at most two workers. No full inventory, browser, Docker, live network provider test or remote mutation ran.

From `tests/`, the before command was:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-poe-web-2034.test.js --maxWorkers=2
```

Before repair: **31 passed, 7 failed**, exit 1, 85.78 s. Pinned 502 sent three times; malformed/HTML/incomplete/reset/partial-body each sent twice; the deadline case hit the 30 s test ceiling. Raw evidence: `/var/tmp/poe-repair-2034.SfJoEWSv/before.log`.

Base checkout: `046795ee95f3ab93e18c6c48da846568bce57c0a`. Final focused command (from `tests/`, same command as the before run): **101 passed**, exit 0, 72.63 s. Raw evidence: `/var/tmp/poe-repair-2034.SfJoEWSv/focused-final.log`. This includes the original 31, all seven restored regressions and 63 additive cases. The original source prefix was compared with HEAD and is byte-identical.

The combined scoped command also passed: **336 tests across five files**, exit 0, 99.90 s, before the final additive proven-unsent fallback case was added. It used:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-poe-web-2034.test.js unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js unit/api/provider-cookie-import.test.js unit/poe-web-provider.test.js --maxWorkers=2
```

Raw evidence: `/var/tmp/poe-repair-2034.SfJoEWSv/final-scoped.log`. The final focused run covers that extra case. Product code did not change between those two passing runs.

Intermediate runs proved the restored seven passing, but stronger added snapshot cases initially failed due to assuming equal-priority account order; those assertions were retained and stored priorities made explicit. An overlapping run loaded the earlier test version before that correction. These were not counted as final green evidence.

Related command (exit 0, **236 passed**, 9.21 s):

```sh
node node_modules/vitest/vitest.mjs run unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js unit/api/provider-cookie-import.test.js unit/poe-web-provider.test.js --maxWorkers=2
```

Root lint commands, each independently invoked with the private environment and 300 s ceiling:

```sh
node node_modules/eslint/bin/eslint.js src
node scripts/build-anti-slop-plugin.mjs
node scripts/check-anti-slop.mjs
```

ESLint exit 0: 0 errors, 348 warnings. Anti-slop build/check exit 0: 0 diagnostics. The generated bundle is unchanged. The failure baseline is untouched. The commit message passes pinned commitlint 18.6.1 with config-conventional 18.6.3 and the unchanged repository config (0 problems, 0 warnings). Behavior documentation is the executor's adjacent comment plus this report.

Remaining uncertainty: mocked fixtures cannot prove live Poe protocol, acceptance, quota charging or account access. Management authority itself is mocked, and pairing is a one-use bearer capability rather than a second browser-owner authentication step. Cost receipts for uncertain accepted work are the separate shared receipt batch. Full local CI and independent review have not been claimed or run here.
