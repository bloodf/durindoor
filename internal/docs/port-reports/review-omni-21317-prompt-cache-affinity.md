# OmniRoute #21317 — prompt-cache session affinity

## Source snapshot

Read-only GitHub API inspection on 2026-11-27: [PR #21317](https://github.com/cheaper-inference/OmniRoute/pull/21317), `fix(sse): scope prompt cache affinity to authenticated sessions`, open, base `release/v3.8.55` at `49f6a0fc52b0f43aa6084c84fda59e4c7f172d92`, head `fix/19803-session-prompt-cache-key` at `04ed7c844f311019264f850b131d8ccdae1bba36`. Changed paths: `changelog.d/fixes/session-prompt-cache-affinity.md`, `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/executeProviderRequest.ts`, new `open-sse/handlers/chatCore/sessionPromptCacheKey.ts`, `open-sse/handlers/chatCore/streamingResponse.ts`, `open-sse/handlers/chatCore/upstreamBody.ts`, new `tests/unit/cache-context-affinity.test.ts`, and `tests/unit/chatcore/streaming-response.test.ts`.

The PR adds an opaque SHA-256 `prompt_cache_key` for supported OpenAI/Codex wire requests when a trusted authenticated API-key ID and a validated client session are available. The digest includes principal, provider, connection, wire model and session. It preserves explicit client keys, gates on cache support and opt-out, and passes the principal through the credential-refresh stream retry. Session extraction checks listed headers, raw request body session/conversation fields, and bounded Claude metadata JSON.

The upstream description above is carried over from the earlier read. It was not re-read in this correction pass, and the upstream "returns the body unchanged without a valid client session" behavior remains subject to verification against the PR head.

## DurinDoor comparison

Reviewed DurinDoor commit: `e380276ed9e875787ace234dcd3220307677a14f` (branch `orq/tp3r51/correct-omni-21317-a1`, worktree clean at start).

Reference trees, as recorded earlier and re-confirmed as commit objects: `origin/main` `29490b783e83176d4d6a4162f76ee3dc79db66ea` and frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`. Both contain the same relevant implementation. The #19803 principal-scoping work is already present: `open-sse/handlers/chatCore.js:416` sets request-scoped `_cachePrincipalId` from `apiKeyId || apiKey`, and `open-sse/executors/default.js:102-110` (`normalizePromptCacheKey`) hashes provider, principal, connection, model and session into an opaque `cc_` key. Explicit caller keys keep precedence. The existing [#19803 report](open-prs-nov25-25-port-2.md) records this partial port and leaves the Codex key path and custom-node wire guard as separate open items. Those dispositions are not re-reviewed here.

Frozen train was not changed.

## Verdict

**Intentional, opt-in, low-severity divergence from the upstream proposal. Not a privacy defect.**

When `providerSpecificData.enablePromptCacheKey === true` and a request has no client session, no assistant-text anchor and no workspace ID, DurinDoor derives a connection-scoped session and hashes it into `prompt_cache_key`. #21317, as recorded in the source snapshot, instead requires a validated client session and leaves the body unchanged otherwise. The effect is that unrelated sessionless conversations on the same principal, connection and model share one cache-affinity key. That affects cache-affinity precision, not confidentiality.

The behavior is deliberate and covered by existing tests, so it is not a defect in the sense the earlier draft claimed. The earlier "missing/wrong behavior" verdict is withdrawn.

## Scoping by dimension

Each dimension is traced from code at `e380276ed9`.

- **Principal (gateway key).** `chatCore.js:416` sets `_cachePrincipalId = apiKeyId || apiKey`. It is part of the hash in `default.js:102-110`. Present on both main and train, and covered by the #19803 work.
- **Connection.** `connectionId` is part of the hash. The sessionless fallback is per connection: `sessionManager.js:259-272` calls `deriveSessionId(connectionId)`, which reuses one `sessionId` per connection from the in-process `runtimeSessionStore` (`sessionManager.js:16`, `:45-75`).
- **Model.** Part of the hash in `default.js:102-110`.
- **Client session (normal translated path).** `open-sse/translator/index.js:273` calls `captureSessionId`, which stores the resolved id in `credentials._clientSessionId` (`index.js:292`). For a sessionless request this is the generated per-connection id. `injectPromptCacheKey` uses it first (`default.js:136`). It does not consult `_clientSessionIsGenerated`.
- **Same-format fallback.** When translation does not run, `captureSessionId` is not called (it is only called from `translator/index.js:273`). `injectPromptCacheKey` then calls `resolveSessionId` itself (`default.js:136-141`), which returns the same connection-derived id from the same store.
- **Assistant-text anchor.** `sessionManager.js:199-219` keys a global store on `scope:connectionId` plus a hash of the accumulated assistant text. Returns `requestScoped: false`, so the generated-session flag does not apply. The principal still scopes the final key because it is hashed in `default.js:102-110`.
- **Workspace.** `sessionManager.js:270-271` returns the workspace id with `requestScoped: false`. This is account-wide by design. Unrelated sessionless conversations in one workspace share a key within the same principal, connection and model. That is the intended grouping, not a leak across principals.
- **Empty principal.** When neither `apiKeyId` nor `apiKey` is present, `chatCore.js:416` does not set `_cachePrincipalId`. `normalizePromptCacheKey` then uses `""` for the principal, so requests with no principal on the same connection, model and session share a key. This needs an unauthenticated or identity-less path to occur. I did not trace whether any route can reach it.
- **Sessionless with no connection ID.** Code reading only, not probed: `deriveSessionId(undefined)` returns `generateBinaryStyleId()` on every call (`sessionManager.js:46-48`), so the key is not repeatable across requests.

## Why changing only the generated-session flag is not enough

Gating `injectPromptCacheKey` on `!_clientSessionIsGenerated` would not reproduce the recorded upstream behavior, for two reasons:

1. The flag is set only on the translated path (`captureSessionId` is called only from `translator/index.js:273`). On the same-format fast path it is `undefined`, so a flag-only gate would not run there and the connection-derived fallback would still apply.
2. The recorded upstream rule is a validated client session. A flag-only gate would still allow the assistant-text and workspace-derived ids, which are not client sessions, and the exact upstream rule for them is one of the items still to verify.

A change that matches upstream would have to change the resolver and both call sites together. That is a separate decision and is not part of this review.

## Existing tests and documentation

- The code comment at `default.js:94-101` states that the key is opt-in ("We do NOT enable it by default") and "scoped to the gateway API key, connection, model and session".
- `open-sse/executors/default.promptCacheKey.test.js` covers: no-op without the flag, the `_clientSessionId` path, the connection-fallback shape (`falls back to resolveSessionId (connectionId) when no captured session`), stability across calls with the same connection, and client-session precedence. The fallback test asserts only the key shape, not its value.
- `tests/unit/portor-19803-prompt-cache-key-scope.test.js` covers gateway key, connection, session, model and provider separation, explicit-key precedence, and that the key does not contain the raw key id or session.
- Public operator docs (`docs/`) do not mention `enablePromptCacheKey`. The opt-in is documented in the code and internal tests only.

## Independent offline probe (reported, not reproduced here)

An independent offline probe, reported to this review and not re-run here, found:

- Same key for the same principal, connection and model across unrelated sessionless requests.
- Different keys for different principal, connection or model.
- Distinct keys for distinct client sessions.

My own isolated run of the same checks could not load `open-sse/executors/default.js` because `undici` is not installed in this worktree (`open-sse/utils/socksDispatcher.js` import failed). I did not install dependencies, as instructed. The static trace above is consistent with the reported probe results.

## Caveats

- No live provider, no network access, and no full CI were run. No product or test files were changed.
- Upstream #21317 behavior was not re-verified in this pass. The divergence is provisional until the PR head is re-read.
- `runtimeSessionStore` is an in-process `Map` capped at 1000 connections with LRU eviction (`sessionManager.js:16`, `:45-75`). The sessionless key is repeatable only within one process lifetime, and it changes after a restart or eviction.
- The digest is unkeyed SHA-256 and is sent to the upstream provider. It is an opaque routing label, not a secret-protecting value. If the principal identifier is guessable, the upstream provider could confirm a guess by hashing it. The principal is `apiKeyId` when present, and the raw `apiKey` otherwise.
- The probe and this review did not exercise the Codex key path, the custom-node wire guard, or the streaming retry path, which belong to other PR items.
- Scratch files from my failed probe attempt remain at `/var/tmp/durindoor-probe` (removal was denied). They contain only a throwaway script and empty directories.

## Existing claims and scope

The full parity refresh has an inventory row for #21317 at head `04ed7c844f311019264f850b131d8ccdae1bba36`, marked "Unrecorded at this head; review required" (`2026-11-27-full-parity-refresh.md:1749`). No more specific active claim for this PR was found. The #19803 principal-scoping work is already implemented and documented, so this report covers only the no-valid-session delta. The supplied ownership claims for auth, credential lifecycle, combo and compression do not overlap this change. No production files, tests, issues or PRs were changed, and the frozen train was not changed.
