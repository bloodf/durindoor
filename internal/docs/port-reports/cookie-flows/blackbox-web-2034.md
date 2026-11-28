# Blackbox Web cookie flow (#2034)

Status: **blocked by reproduced safety regressions**. The focused public-route run has three failures described below. No live sign-in or provider request was made.

The production registry profile declares `https://app.blackbox.ai` and the single required `next-auth.session-token` cookie. It declares no chunk prefix, optional cookie, or localStorage credential; chunk-only input is refused. The dashboard parser accepts Cookie headers, cURL, and HAR, subject to the actual contract and origin checks. A raw header has no independently known origin. HAR can contain multiple matching accounts, requiring selection. The extension reads the exact name from the confirmed tab's cookie store and does not enumerate cookies or read localStorage for this provider.

Existing `provider-cookie-import-contracts.test.js` and `blackbox-web-provider.test.js` cover the registry contract and executor separately; the generic extension and import suites use other providers or synthetic descriptors. The new test connects the real pairing to extension capture, isolated SQLite import, and the executor with a selected synthetic account and mocked proxy transport. It also exercises parser candidates through import, update ownership, foreign origin, expired cookie, unexpected localStorage, management authorization, and redaction. The network and browser are mocked, and the management authority and database adapter boundary are fixtures; the registry, parser, handlers, connection repository, and executor are production code. It does not establish a real browser session, real proxy connectivity, provider acceptance, or live sign-in parity.

Evidence command, to run with the task's private credential-free environment and installed isolated dependencies:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-blackbox-web-2034.test.js --maxWorkers=2
```

Local source-only checks: `node --check tests/unit/cookie-flow-blackbox-web-2034.test.js` and `git diff --check` passed. CodeGraph query was unavailable because the required 1.6.2 executable was not installed. No upstream source was consulted and no upstream behavior is asserted here. No product repair is proposed on the basis of these unexecuted tests.

## Public-route extension

The appended suite uses `cookiePublicFlow2034` with real SQLite, pairing, import, connection selection, registry/executor, and the OpenAI and Anthropic public handlers. Synthetic vendor transport is the only network. It adds pinned-account buffered/streamed cases with two strict proxy bindings, dispatch after each supported parser input, update/ownership and refusal checks, session error checks, a session-401 fallback assertion, and an uncertain chat transport assertion. The focused run below exercises synthetic responses only; it makes no claim about live Blackbox behavior.

On this checkout, the following credential-free commands were attempted with `env -i`, private `/var/tmp/blackbox2034-run/{home,data,tmp,cache}`, and `timeout 300s`. All failed before checks could run because dependencies were absent:

- `node node_modules/eslint/bin/eslint.js src`: missing ESLint.
- `node scripts/build-anti-slop-plugin.mjs`: missing esbuild.
- `node scripts/check-anti-slop.mjs`: missing oxlint.
- `node tests/node_modules/vitest/vitest.mjs run unit/cookie-flow-blackbox-web-2034.test.js --maxWorkers=2 --config tests/vitest.config.js`: missing Vitest. Run the equivalent command from `tests/` in the native isolated dependency gate as shown above.

Source inspection identifies a concrete concern to validate in that gate: `BlackboxWebExecutor.runSession` only rejects redirects, 401 and 403 from `/api/auth/session`; a 429 or 502 session response proceeds to the billable `/api/chat` request. The new pinned-session error cases require the refusal to stop there. If reproduced, the minimal repair is to handle non-success session responses before `sendBillable`, preserving their safe error status and without sending a chat request. Separately, successful chat responses are read as arbitrary text, so a 200 HTML login page appears capable of becoming a successful completion. This HTML scenario has not been executed here; a regression must establish the actual public-route behavior before prescribing a repair. A check must reject HTML login pages before producing a completion while avoiding a retry of the already submitted chat.

Remaining acceptance work: execute the new cases and resolve any fixture or product failures; add runtime coverage for HTML, malformed session JSON, chat quota/error bodies, abort, body deadline, partial text and no success terminal, with no replay after an uncertain accepted chat. The current helper does not expose a mechanism to control request cancellation or body deadlines beyond its signal argument and 100 ms environment values; whether an extension is necessary should be determined by those cases rather than changing the shared helper here. The executed results and remaining failures are detailed below.

### Executed focused run and repair handoff

After installing locked root and test dependencies into this checkout with a private credential-free environment, `cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-blackbox-web-2034.test.js --maxWorkers=2 --reporter=dot` failed: **20 passed, 3 failed**. The original three cases, all eight pinned success cases, all three parser-to-dispatch cases, ownership/refusal checks, session 401 and safe 401 fallback passed.

The ordinary failing tests preserve bounded runtime reproductions: a session 429 was followed by a chat POST; session 502 produced three session/chat pairs; and a chat transport rejection after a successful session produced three session/chat pairs. The latter has an uncertain billable outcome, so replay is unsafe. The required product repair must both stop non-success session responses before `sendBillable` in `open-sse/executors/blackbox-web.js` and prevent the public routing retry path from restarting a Blackbox session after a billable dispatch whose outcome is uncertain. Trace the retry decision and carry dispatch provenance through that boundary; do not globally suppress safe pre-dispatch fallback. Re-run these unchanged ordinary assertions after repair.

Root direct ESLint passed with 348 warnings and zero errors; the anti-slop build and anti-slop check passed (zero diagnostics). The earlier missing-dependency attempts above describe the initial state. HTML, malformed JSON, abort, body deadline and partial-response cases remain unimplemented; the acceptance requirement is not complete.
