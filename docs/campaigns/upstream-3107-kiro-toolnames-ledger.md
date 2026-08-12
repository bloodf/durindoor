# Upstream #3107 — Kiro tool-name restoration & cache-token preservation

Ports `decolua/9router#3107` into DurinDoor.

## Problem

Two independent defects on the Kiro route:

1. **Tool names were corrupted, not just renamed.** Kiro's CodeWhisperer API
   rejects a tool name containing consecutive underscores, so a client tool
   named `codex_app__send_message_to_thread` 400s. Nothing sanitized the name
   on the way out, and nothing restored it on the way back — a client that
   registered a double-underscore tool either got a hard 400 or, once
   sanitized upstream, received tool calls addressed to a name it never
   registered and could not dispatch.
2. **Cache tokens were dropped.** `kiro-to-claude` built `state.usage` from
   `prompt_tokens`/`completion_tokens` only. Kiro reports cache hits either
   flat on `usage` or nested under `prompt_tokens_details`, so every cached
   turn was billed and displayed as uncached.

## Change

**Request** (`open-sse/translator/request/openai-to-kiro.js`)
- Added `sanitizeKiroToolName`, collapsing `/_{2,}/` to a single underscore.
- `convertMessages` takes a `toolNameMap` and records `sanitized → original`
  only when the name actually changed.
- The map rides the payload as a **non-enumerable** `_toolNameMap`, so it never
  reaches the wire. This matches the existing convention in
  `services/claudeCodeToolRemapper.js`; `chatCore.js:458` already lifts
  `_toolNameMap` off any translated body and passes it to the response
  translator, so no plumbing changes were needed.

**Response** (`kiro-to-openai.js`, `kiro-to-claude.js`)
- Both look up `state.toolNameMap` and emit the original client-facing name,
  falling back to the received name when unmapped.
- **The live path is the executor-produced chunk, not the raw event.**
  `KiroExecutor.transformEventStreamToSSE` converts the binary EventStream to
  OpenAI chunks inside the executor, and `kiroToOpenAIResponse` early-returns
  anything already shaped as `chat.completion.chunk`. Restoring names only in
  the raw `toolUseEvent` branch would have left production emitting sanitized
  names while the tests passed. `restoreToolNames` therefore runs on the
  early-return branch, which is the only seam every live tool call crosses.
  It returns the chunk unchanged when no mapping applies, so the common
  no-tool case allocates nothing, and Kiro credit-stripping still applies.
  `kiro-to-claude` already consumes executor chunks directly, so its fix is on
  the live path as written.

**Usage** (`kiro-to-claude.js`)
- `cache_read_input_tokens` / `cache_creation_input_tokens` are read flat-first,
  then from `prompt_tokens_details`, and only set when numeric. Upstream's
  nested aliases (`cached_tokens`, `cache_creation_tokens`) are not emitted by
  this fork's Kiro path and are deliberately not accepted.

## Divergence from upstream

Upstream threads the map through a module-level global. This fork uses the
per-request `_toolNameMap` property already established by
`claudeCodeToolRemapper`, because a module global leaks tool names across
concurrent requests — two simultaneous Kiro calls with different tool sets
would restore each other's names.

## Verification

```
tests/unit/kiro-tool-name-cache-3107.test.js — 5 passed
```

Proven load-bearing twice:
- Reverting the three source files with the tests kept yields `Tests 3 failed`.
- Reverting **only** the executor-seam fix in `kiro-to-openai.js` yields
  `Tests 1 failed | 4 passed` — the executor-chunk test is what catches the
  production path, which an earlier revision of this port missed entirely.

Full gate: `Raw failures: 0`, baseline untouched, `npm run lint` unchanged from
`main` (184 pre-existing warnings, 0 errors).
