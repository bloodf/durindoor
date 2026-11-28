# Imported ChatGPT Web Codex lane compatibility (#2034)

This repair addresses Defect 1 of `chatgpt-web-codex-2034.md` (report
`015933dfc6598fa456cc257008c1e2a23541c9ef`). All seven lanes remain in the
catalog. Import still leaves transport unset; that resolves to `auto`.
The shared cookie-chunk-gap finding is separate and unchanged.

## Source boundary and reproduction

Source freeze: 2026-11-27T23:49:25.752045Z. The last local commit before that
instant is `d5c8602f098540086a00f174e25e5b885f5006c4`.
Working base: `fbf30334f2dc4899e900a215252e3e020b4cbe2f`.
The adapter, HTTP model map and canonical Codex registry descriptor have no diff
between those revisions. No post-freeze upstream head was fetched or adopted.

The frozen resolver was executed with all seven mapped names and a conflicting
`reasoning_effort: "low"`: Luna and Think resolve; Instant, Medium, High,
Extra High and Pro throw unsupported-model errors before session creation.
This reproduces the selection defect independently of any provider.
The unchanged pre-repair 34-case cookie-flow suite was also run with the frozen
adapter, then the candidate files restored before post-repair verification.

Read-only Git-object comparison:

- DurinDoor `open-sse/executors/chatgpt-web/models.js` defines Instant as
  `gpt-5-6`, Medium/High/Extra High as `gpt-5-6-thinking` with
  standard/extended/max effort, and Pro as `gpt-5-6-pro` with standard effort.
- The preexisting adapter supports those corresponding Instant, Thinking and
  Pro selections. Its Thinking effort resolver already maps medium/high/xhigh
  to positions 1/2/3; Instant and Pro already use positions 0/4.
- OmniRoute, MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza:
  `fbd339668384803bc3a9d42370fc413a55e013d5`,
  `open-sse/utils/chatgptWebExecutorAdapter.ts`, has the same existing
  selections. Attribution applies to the existing selection logic; this repair
  adds aliases, not a new picker implementation.
- OmniRoute `4265bb2ad5477450a07d3a43ea33a62c6c874878`,
  `open-sse/config/providers/registry/chatgpt-web-codex/index.ts`, lists exactly
  the seven lane identifiers in the current canonical DurinDoor descriptor.

These sources establish aliases to existing supported selections, not live UI
availability. No picker label, index or model identifier was invented. Because
all seven lanes have an existing corresponding selection, no lane requires a
new HTTP-only auto-routing rule. Unknown browser names still fail closed.

## Behavior and exact migration

The adapter resolves the five Codex aliases to existing selections with fixed
lane effort. Request reasoning settings cannot turn one lane into another.
Luna/Think are unchanged. Explicit HTTP retains the existing model/effort/hint
mapping; explicit browser retains refusal for unsupported requests. Tools in
auto use HTTP before browser startup; explicit browser refuses tools.

Only session startup can signal safe HTTP fallback. After a turn starts, a
`BrowserUnavailableError` is converted to an ordinary error with its cause so
that the outer executor cannot replay potentially accepted work on HTTP.
Other errors, aborts and successful turns do not trigger a second dispatch.

Only the five authorized cases in the existing cookie-flow test were migrated:

| Case | Before | After (existing selection) |
| --- | --- | --- |
| instant / `gpt-5.6-sol-instant` | 400, no send | 200, Instant position 0 |
| medium / `gpt-5.6-sol-medium` | 400, no send | 200, Thinking medium position 1 |
| high / `gpt-5.6-sol-high` | 400, no send | 200, Thinking high position 2 |
| extra-high / `gpt-5.6-sol-xhigh` | 400, no send | 200, Thinking xhigh position 3 |
| pro / `gpt-5.6-sol-pro` | 400, no send | 200, Pro position 4 |

Each migrated case asserts one session and one turn, the exact existing
selection, imported cookie chunks, connection id, proxy and redirect guard,
no TLS/global-fetch replay, unchanged stored credential and secret-free output
and logs. The old inventory remains **34 cases**; all other refusal, isolation,
rotation, import and capture cases are untouched. No baseline changes.

## New verification scope

`tests/unit/fix-chatgpt-codex-auto-lanes-2034.test.js` uses real authenticated
pairing and cookie import handlers, private SQLite, saved connections, public
OpenAI Chat Completions and Anthropic Messages handlers, translation and the
actual executor. Only operator authority, the TLS network seam, global fetch,
and browser session/turn are mocked. Cookies, tokens and proxy hosts are synthetic.

The main matrix covers seven lanes × two formats × buffered/streamed × two
accounts × unset/auto/browser/http transports: **224 successful requests**.
Browser assertions bind the exact selection, connection, cookies, proxy and
redirect guard to one turn with no TLS calls. HTTP assertions bind model,
effort, Think hint, cookie, bearer and proxy to exactly one conversation send.
Both formats' stream terminators and buffered response shapes are checked.

Additional cases cover public unsupported-model refusal for auto/browser,
direct browser selection refusal, auto tools versus browser tools refusal,
aborted-before-dispatch and in-turn cancellation, unknown/accepted turn errors,
a startup-class error after dispatch, safe startup fallback and explicit
browser startup refusal. No provider, token, browser, Docker or live service was
used. Mocked browser success does not prove the real UI selects these models.

## Local checks and remaining gates

Dependencies were absent initially. Root, CLI and tests frozen-lockfile installs
used a new private store in `/var/tmp/codex-lanes-2034.jEjYI0`, never a shared
symlinked graph. All install/test/lint commands used `env -i`, explicit PATH,
LANG and CI, private HOME/DATA_DIR/TMPDIR and caches, no inherited credentials,
a 300-second command timeout and at most two focused Vitest workers.
CodeGraph 1.6.2 was unavailable; bounded checkout searches and Git objects were
used instead. No tool installation or source-cache fetch was used for reading.

From `tests/`, under that environment:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/fix-chatgpt-codex-auto-lanes-2034.test.js \
  unit/cookie-flow-chatgpt-web-codex-2034.test.js \
  unit/chatgpt-web-codex-provider.test.js \
  unit/chatgpt-web-executor-adapter.test.js \
  unit/chatgpt-web-transport.test.js \
  unit/chatgpt-web-transport-handoff.test.js --maxWorkers=2
```

Existing module-reset tests
emit MaxListenersExceededWarning; those warnings were not suppressed.
The complete local CI/build and independent clean-main review gates are not
claimed by focused verification. No PR, push or merge was requested or done.

## Documentation owner follow-up

`docs/providers/chatgpt-web-codex.mdx` step 4 presents all seven lanes after
normal import without the live picker verification caveat. Its setup/support
claim needs review by the documentation owner: this repair proves offline lane
binding, not browser sign-in, actual picker positions, plan access, Cloudflare
or Sentinel acceptance. That shared public page was not edited here.

## Explicit HTTP validation gap (outside adapter ownership)

An additional exploratory assertion tried to require local unknown-model
refusal under explicit HTTP. It failed: the public route forwarded
`unsupported-lane` to the HTTP executor and the permissive synthetic backend
returned 200 (102 other tests passed). Source confirms
`resolveChatGptModel` uses `MODEL_MAP[model] ?? model`, deliberately allowing
raw backend slugs. Explicit HTTP bypasses this adapter entirely. Auto tool
requests also use that HTTP path. No local HTTP allowlist is claimed here.
The exploratory HTTP row was removed from the new test matrix; the auto and
browser refusal rows remain. No preexisting test was changed for this finding.
Repairing this broader validation gap would require ownership of the HTTP
executor/model resolver or its caller. Those files were not changed.

## Final results

- Frozen adapter plus original cookie-flow suite: **34/34 passed**, reproducing
  all five original refusals and the successful HTTP requests for seven lanes.
- Candidate focused run: **102/102 passed across six files**; new suite **23/23**.
  The existing cookie-flow suite remains **34/34** with exactly five migrated rows.
- Root `pnpm run lint`: exit 0, **0 errors / 348 warnings**; anti-slop gate
  passed with 0 diagnostics across 3694 files. No unrelated source was repaired.
- `git diff --check`: passed. Only the adapter, authorized five-row test
  migration, new scoped test and this report changed.
- Private final evidence: `/var/tmp/codex-lanes-2034.jEjYI0/final-tests.json`
  and `final-tests.log`. Full CI/build, independent review and live UI remain
  unrun. This scoped patch is committed locally; no publication was made.
