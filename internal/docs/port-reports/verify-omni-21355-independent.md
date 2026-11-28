# Independent verification: OmniRoute #21355 — truncated tool calls keep `length` / `content_filter`

Source-only verification. No product edits, no issue or PR, no links, watches or listings, no pushes, no service launches, no dependency installs, no persistent memory, no `~/.9router`. Nothing was executed against a live provider or a real secret.

## Scope and baselines

- Current main: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (`fix(usage): reconcile observed quotas and cache creation aliases (#2690)`).
- Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c`, tree `fd449b3cefa538d912c3b51dee0ed774ede580e6` (verified with `git show -s`). Not modified.
- Aggregate `orq/tp3r51/integration` was not used as a baseline. It was read only to fetch the prior report `internal/docs/port-reports/review-omni-21355-truncated-tool-finish.md`.
- Files read through `git show <commit>:<path>`; the frozen train was never checked out.
- Upstream: I did not re-read the PR through `gh` in this pass. The upstream intent below is taken from the prior report's summary of the PR description and is marked as unverified here.

## Verdict

- **Defect (confirmed statically in both trees), not claimed, not fixed.** On the non-streaming JSON path and on the SSE-synthesis path for a non-streaming upstream completion, an OpenAI-shaped completion with `tool_calls` is rewritten to `finish_reason: "tool_calls"` unconditionally. This overwrites `length` and `content_filter`.
- **Severity: important** for OpenAI-compatible clients that act on `tool_calls` (a truncated call with partial arguments gets executed). Medium if the client is known to validate arguments. This judgement assumes the upstream really emits truncated `tool_calls` with `length`; I did not reproduce that against any provider.
- **Already correct elsewhere:** the live streaming path, the buffered SSE-to-JSON path, the Responses projection and the Claude client projection keep `length` on tool turns. The inconsistency between paths is itself evidence that the JSON overwrite is accidental.
- **Scope:** no redaction, privacy or credential logic is involved in this finding. The auth and sync lanes do not claim it (see below).

## Source trace

Identical in both commits. Line numbers are the same in `32a783d7` and `29490b78` for these blocks:

1. `open-sse/handlers/chatCore/nonStreamingHandler.js:873-881`, comment and block:
   ```js
   // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
   if (translatedResponse.choices?.[0]) {
     const choice = translatedResponse.choices[0];
     const msg = choice.message;
     const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
     if (hasToolCalls && choice.finish_reason !== "tool_calls") {
       choice.finish_reason = "tool_calls";   // line 879
     }
   }
   ```
   The comment justifies the rule for non-standard values. `length` and `content_filter` are standard OpenAI values, so the comment does not cover them.
2. Same file, line 896 onward: `normalizeOpenAIFinish("tool_calls")` is a no-op (`open-sse/translator/concerns/finishReason.js:16-22` only maps Claude `stop_reason` literals). The client receives `tool_calls`.
3. Synthesis branch, `nonStreamingHandler.js:984-986`: when the client asked for SSE and the upstream returned JSON, the intermediate choice is set to `finish_reason = "tool_calls"` whenever `tool_calls` is non-empty. This is the same unconditional overwrite.
4. Reachability: for `sourceFormat === targetFormat === OPENAI` with `stream: false`, `translateNonStreamingResponse` returns the body without projection (the Responses projection at `nonStreamingHandler.js:~346` applies only to Responses clients). Step 1 therefore runs on the upstream finish reason.

Paths checked and **not** defective:

| Path | Location (train = main) | Behaviour for `length` + tool calls |
| --- | --- | --- |
| Live OpenAI SSE chunks | `open-sse/utils/stream.js` (finish handling at ~479, ~1200; no `tool_calls` promotion) | Forwarded unchanged |
| Buffered SSE to JSON | `open-sse/handlers/chatCore/sseToJsonHandler.js:257-260` | Promotes only when the reason is `stop` or missing |
| Responses projection | `open-sse/translator/response/completionProjector.js` ~250-254 | `incomplete` + `max_output_tokens` maps to `length`, and tool promotion follows only after that |
| Claude client projection | `open-sse/translator/concerns/finishReason.js:137-143` | `claudeStopReasonWithToolCalls` promotes only ordinary stop reasons |
| Gemini non-stream | `nonStreamingHandler.js:479` | Promotes only `stop` |

Other promotion sites found by grep that are **not** part of this finding: `translator/response/ollama-to-openai.js:70` and `:121` (Ollama `done_reason` overwritten to `tool_calls`), `commandcode-to-openai.js:202`, `gemini-to-openai.js:230`, `openai-to-claude.js:577` (Claude-side marker, reads back the reason). The Ollama lines are the same class of defect as the prior report's adjacent observation, but they were not traced to a client-visible result here.

## Reproduction (offline, partial)

Attempted: importing the real `nonStreamingHandler.js` from an `open-sse` + `src` export of main in `/var/tmp`. It fails with `ERR_MODULE_NOT_FOUND` because the repo `package.json` and the `@/` alias are missing, and the dependencies are not installed (installs were out of scope). So the full handler was not run.

Substitute performed: the verbatim lines `nonStreamingHandler.js:874-881` from main were extracted with `sed` into a harness (`/var/tmp/verify-21355/repro/json-path.mjs`) and run on six inputs under a stripped environment. The one body shape used is:

```json
{"choices":[{"index":0,"finish_reason":"length","message":{"role":"assistant","tool_calls":[{"id":"t1","type":"function","function":{"name":"lookup","arguments":"{\"q"}}]}}]}
```

Observed client-visible `finish_reason`:

| Upstream `finish_reason` | Result |
| --- | --- |
| `length` | `tool_calls` (defect; expected `length`) |
| `content_filter` | `tool_calls` (defect; expected `content_filter`) |
| `stop` | `tool_calls` (expected by design) |
| `null` | `tool_calls` (expected by design) |
| `function_call` | `tool_calls` (expected by design per prior report's six-case matrix) |
| `end_turn` | `tool_calls` (expected by design per prior report's six-case matrix) |

Uncertainty: the harness reproduces the block verbatim but not the handler's surrounding control flow (`hasTokenLimitCompletion`, parsing, restore of tool-name aliases). Those steps do not alter `finish_reason` on this path, by reading. A full-handler test needs the normal dependency install, which was out of scope here.

Suggested port test: a unit test under `tests/unit/` that calls `handleNonStreamingResponse` with the body above, `stream: false`, and asserts `length` is kept; plus the same for `content_filter` and the SSE-synthesis branch (`stream: true` client, JSON upstream).

## Active claims and overlap

- `internal/docs/port-reports/omni-review-transport.md` marks #21355 as out of scope ("SSE response framing"). The prior report already notes this is wrong for the JSON path. This review agrees.
- `2026-11-27-full-parity-refresh.md` row O0056 is "unrecorded". This report resolves that row for verification purposes only.
- `1073-june-existing-response-contracts.md` (~line 450) says `finish_reason` in `{length, tool_calls}` is a legitimate completion for the **empty-content** check. It does not justify the promotion. It is consistent with the finding.
- No claim covers the JSON-path or synthesis-path lines. The auth lane and sync lane do not include #21355 or these lines. The lines were last changed by bulk-sync commit `4a789fb645` ("ci: vendor anti-slop ..."), which suggests the block arrived through a merge rather than a deliberate fix; blame is not proof of intent.
- Overlap risk: `nonStreamingHandler.js` is a hot file (combo fallback, usage, Gemini native, refusal handling). A narrow change to the two promotion sites should not touch those branches, but any port should rebase onto the current file rather than apply the upstream diff, since upstream file names do not exist here.

## Recommended port (not applied)

Promote to `tool_calls` only when the upstream reason is `stop` or absent, at both sites (`nonStreamingHandler.js:878` and `:984`), keeping `length` and `content_filter` as-is. A shared helper next to `normalizeOpenAIFinish` in `open-sse/translator/concerns/finishReason.js` avoids duplicating the rule. The Ollama sites are a separate decision.

## Open questions

- Whether real OpenAI-compatible providers return truncated `tool_calls` with `finish_reason: "length"` on JSON responses. The upstream PR reports 20/20 reproduction for one model; I did not check it.
- Whether the upstream six-case matrix matches the prior report's summary. Not re-read here.
