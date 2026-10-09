# Issue 1115 authorization acceptance

Status: independently observed focused and disposable HTTP acceptance passes for the frozen fixture/source contract, not full CI or issue closure. Historical baseline: 759 matrix passes and one stale-Bearer/valid-x-api-key failure. After the principal fix: 760 matrix passes, 254 neighboring tests and two private both-valid ownership checks. Later routing proof: 140 passes. Final HTTP proof: 686 matrix rows, 90 private semantic checks, three dual-credential checks and one limited-vision check passed with clean fixture journals. Criterion 3 remains **MISSING** historical failing-before evidence for pre-existing ownership changes and the static-leaf review correction; full CI remains **BLOCKED/unproven**. No live-provider claim.

## Historical pre-edit gaps and exclusions

| Boundary | Existing coverage | Missing integration supplied here |
| --- | --- | --- |
| Native file/batch ownership | `unit/native-provider.test.js:100-232`: create/detail/content/results/cancel/delete, foreign/unknown owner, CLI exception, list filtering/pagination; auth/owner/policy mocked independently | Real identity resolver, model policy and account selector across every configured tracked/created/list operation and seven principals |
| Native media ownership | `unit/native-provider.test.js:66-97`: MiniMax poll pin, foreign owner, creator accounting, response cancel | All configured MiniMax/minimax-cn file/voice/async speech/video and xAI video resource operations, unknown owner, model/account scope |
| Principal resolution | `unit/resource-ownership.test.js:29-59`: CLI/local/key expiry with extraction mocked | Real CLI authentication, valid/foreign/inactive/expired keys; independent stale Bearer plus valid x-api-key reproduction |
| Path classification | `unit/dashboard-guard.test.js`: scattered canonical/alias/dashboard/key rows | Canonical `/api/v1`, `/v1`, duplicate `/v1/v1`, fully encoded paths crossed with dashboard, CLI, owner, foreign, inactive, expired and anonymous |
| Reroute authorization | `unit/vision-bridge-chat.test.js`: allowed/denied bridge with policy/selector mocked | Real model policy and provider-account selection through actual vision recursion; denied target retains authorized original |
| Combo scope | `unit/api-key-provider-account-scope.test.js`: selector intersection and quota reselect | Real stored combo resolution, uppercase name, member model ACL and combo/key account intersection; valid `models` and `members:[{id,weight}]` row |
| Framework routing | Handler tests do not run Next rewrites | Separate `security-authorization-http.mjs` sends actual HTTP and checks a fixture-provider dispatch journal |

At the initial specification stage, existing tests were regression exclusions by source inspection only, not newly verified passing claims. Later neighboring-test results are recorded below; the prior 77 focused tests alone did not prove this matrix. Local file/batch storage tests in `unit/v1-batches.test.js` were not changed by the specification assignment. Native resources do not support model rerouting: cross-provider substitution must return 400, not be counted as an allowed reroute.

## Files added by the original specification assignment

1. `unit/security-authorization-matrix.test.js`: integration matrix. Real authentication, ownership resolution, model/combo resolution, ACL, provider-account selector, native handler and chat routing. In-memory persistence and provider transport/execution only; quota preflight/windowed limits are isolated and explicitly outside this issue. Unexpected database/network access fails closed.
2. `security-authorization-http.mjs`: real HTTP acceptance runner; no mock route mapper or injected decoded params.
3. This acceptance map.

The original assignment recorded five pre-existing dirty files as untouched and parent authorization for its added files. That statement describes the historical specification stage, not the current candidate: subsequent principal and routing corrections have separate owners and receipts. This documentation refresh changes only `tests/security-authorization-acceptance.md`; it does not edit the other 11 intentional candidate paths or the excluded bundle.

## Independent execution

The original execution outline below is retained for context, not as a record of commands run by this documentation writer. Exact verifier commands and isolation evidence are retained in the receipts listed below. Execution belongs to the independent verifier, in disposable state with private existing dependencies:

```sh
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js tests/unit/security-authorization-matrix.test.js
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js tests/unit/native-provider.test.js tests/unit/resource-ownership.test.js tests/unit/dashboard-guard.test.js tests/unit/api-key-provider-account-scope.test.js tests/unit/vision-bridge-chat.test.js tests/unit/v1-batches.test.js
node tests/security-authorization-http.mjs /absolute/path/to/disposable-fixture-manifest.json
```

Use the installed Vitest binary if dependency layout differs. Do not install into shared dependencies. Do not run any command against production data or real accounts.

### HTTP fixture contract

The verifier must start the **actual application** against disposable state behind a remote-peer test ingress. A direct loopback connection is insufficient: the production guard intentionally admits trusted loopback callers. Disable real egress; route provider transport to a recording disposable fixture service. Do not patch application auth, ownership, policy, route dispatch or Next rewrites.

The runner takes a JSON manifest containing:

- `disposable: true`, loopback `origin` of the test ingress, and absolute `journal` path. The journal is JSONL, append-only, recorded before each fixture upstream response. Each record includes exact `provider`, `account`, `model`, and `path`.
- `principals`: seven header objects named `dashboard`, `cli`, `owner`, `foreign`, `inactive`, `expired`, `anonymous`. Generate them only inside disposable state. Dashboard has only its test session cookie; CLI has only its test CLI token. Never copy host credentials. Anonymous is `{}`.
- `cases`: each row has `name`, `family`, `scope`, canonical public `path` beginning `/v1/`, `method`, optional `query`, `headers`, `body`, and `expected` keyed by all seven principals. Each expectation requires exact `status` and `dispatches`; optional `json`, `ids`, and `absent` assert output/ownership.

Required families: `file`, `batch`, `media`, `direct`, `reroute`, `combo`. Required scopes: `allowed`, `model-denied`, `account-denied`, `combo-denied`, `unknown-owner`. Include known/foreign/unknown native resources, both Anthropic lists, and actual vision reroute with allowed original/denied target. Include a `/v1/responses` row to exercise `/responses` and `/codex/responses` rewrites. The runner expands each row across canonical, alias, duplicate-v1 and encoded paths and every principal. Root aliases apply only to Responses; they are not invented native resource aliases.

Use repeatable seeded reads and stateless chat requests. Creation/deletion transitions are covered by the unit matrix; HTTP rows must not delete a shared seed before sibling rows. Every success must return known fixture output and dispatch to the expected account/model. Every denial must have zero dispatches. A 401/403/404 alone is not routing proof. Fixture exceptions, DB sentinels and missing mock exports are harness failures, not authorization findings.

### Historical reproduction and principal correction

The regression `uses the authenticated x-api-key owner when Bearer is stale` initially predicted a discrepancy: `resolveClientApiKey` checked all candidate credentials, while `resolveResourceOwner` extracted the first candidate independently. The frozen matrix then reproduced it: 403 instead of 200, yielding 759 passes and one failure. This is now an observed discrepancy, not an untested source-inspection hypothesis.

After the separately owned principal correction, the unchanged 760-row matrix passed, including both status 200 and the resource-id assertion for that exact row. Seven neighboring files passed 254 tests. Two additional private rows proved valid Bearer precedence: the Bearer-owned resource returned 200 with one provider-fixture dispatch; the resource owned only by the second valid x-api-key returned 403 with zero dispatches. The probe collected 762 rows but executed only those two; its 760 filtered rows are not additional passes.

### Observed chronology and bounded proof

Verifier receipt paths below are relative to retained STATE `delivery-lead/security-1115-verifier/`, outside the repository. These are evidence references, not instructions to publish private fixture data.

1. `principal-receipt.md` preserves the 759/1 failing-before baseline, the earlier 224-neighbor result, and the later 760/254/2 passing results. Authentication, ownership, model/combo policy, account selection and native handling are real; persistence and provider transport/execution are fixture doubles. This is integrated handler evidence, not HTTP routing proof.
2. The historical encoded-path HTTP 404 remains a real earlier routing failure; later success does not erase it. `routing-freeze-review.md` identified missing static-leaf normalization by review, not a runtime failing-before reproduction. `static-leaves-review.md` records the bounded correction for `files/[id]/content`, `batches/[id]/cancel` and `messages/batches/[id]/{cancel,results}`. This is not blanket support for arbitrary encoded paths or IDs.
3. `http-single-namespace-proof-receipt.md` records 24 routing and 116 dashboard tests passing (140 total). Its 686 HTTP matrix rows passed, but the overall attempt failed because the recording relay rejected requests. No private check was counted as fully passed; the remaining semantic checks, three dual-credential checks and limited-vision check were unrun. Earlier 133-pass routing evidence applies only to its superseded source/test freeze.
4. `http-minimax-proof-receipt.md` records the later authorized invocation: exit 0, 686/686 matrix rows, 90/90 private semantic-output checks, 3/3 dual-credential checks and 1/1 limited-vision check. The completion marker was present and `fixture-errors.jsonl` absent. The operation journal contains 263 accepted rows across matrix and private checks, not 263 matrix-only operations; discovery has two separately classified accepted rows and synthetic local MiniMax quota has one. The primary quota request succeeded; the fallback was not exercised. Historical rejected-call attribution remains inferred, not retrospectively proven.

HTTP proof runs the actual Next application and real SQLite driver against a private seeded DB, with a remote-peer ingress and recording local provider relay. Bounded fixtures cover file, batch, media, direct, reroute and combo cases; seven principals; configured canonical, alias, duplicate-v1 and encoded spellings; Responses aliases; model/account/combo denials; known/foreign/unknown resources; and the specified semantic-output assertions. Native creation/deletion transitions belong to the unit matrix, not shared HTTP seeds. The limited-vision check proves a denied target retains the original provider and returns the fixture answer. These results do not enumerate or prove every production route, resource ID, provider operation or configuration.

The final verifier checked its 13-source and 12-harness freeze before and after execution. Actual seed, driver, app and runner wrapper records show UID/GID maps `0 1001 1`, zero capability sets, `NoNewPrivs: 1`, and read-only protected source/dependency/harness/runtime roots. These are same-PID pre-exec measurements followed by `os.execve` and passing identity checks, not independently remeasured post-exec capability masks. Genuine journal peers are `192.0.2.1`; the relay serves local fixture responses without upstream forwarding. The launcher was reaped. This proves the retained child boundary and fixture contract, not E12 success, live upstream availability or live subscription quota.

## Closure gate

**Criterion 3: MISSING** historical failing-before evidence for the pre-existing ownership changes and the static-leaf review correction. The reproduced principal 759/1 regression and historical encoded-path 404 do not supply failing-before proof for every other change. Later passing tests and source review do not reconstruct missing historical evidence.

**Full CI: BLOCKED/unproven. Issue closure: NOT authorized.** Focused and bounded HTTP passes do not replace full suite/lint, criterion 3 evidence or independent review. Independent nonwriter review of this frozen documentation delta must precede coordinator materialization authorization; this document does not claim that review or authorization has happened.

This documentation writer ran no tests, gates, builds, lint, formatters, application scenarios or commits. No production data, real accounts or live providers were exercised by this refresh. All execution claims above are attributed to retained independent verifier receipts.
