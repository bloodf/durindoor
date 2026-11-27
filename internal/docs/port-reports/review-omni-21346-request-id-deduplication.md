# OmniRoute #21346 request ID deduplication review

Review date: 2026-11-27  
Verdict: **intentional/inapplicable (existing disposition retained)**

## Upstream candidate

Read-only metadata came from `gh api repos/cheaper-inference/OmniRoute/pulls/21346` and `/files`:

- PR #21346, `fix(sse): deduplicate repeated requests by client X-Request-Id (KEA-9623)`, open, non-draft.
- Head `a21607ce66b2a136768b351bd708c5ab8353afdc`, branch `fix/kea-9623-request-id-dedup`.
- Base `release/v3.8.55`, SHA `0a1fe5ef8f5cbc5496200314bcec11aba9d545f0`.
- Changed files: `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/idempotency.ts`, `src/server/authz/pipeline.ts`, `tests/unit/kea-9623-request-id-dedup.test.ts`, and the one-line changelog entry `changelog.d/fixes/kea-9623-request-id-dedup.md`.

The PR preserves a valid client `X-Request-Id` through `CLIENT_API` authz and re-reads the idempotency response after waiting for the execution slot. The latter closes the concurrent retry gap for both `X-Request-Id` and `Idempotency-Key`. Its tests exercise sequential and overlapping retries through the proxy and chat route, plus replacement of an overlong client ID. This description is based on the PR metadata/body and file patches, not a local execution of upstream code.

## DurinDoor disposition

The unchanged prior disposition is recorded in [omni-review-transport.md](omni-review-transport.md): request-identity/idempotency feature, out of scope for that transport census. The broader [2026-11-27 full parity refresh](2026-11-27-full-parity-refresh.md) lists this head as requiring review; this note resolves that inventory row and does not reopen the prior transport disposition.

The local gateway does not have the upstream `src/server/authz/pipeline.ts` surface. Local `src/sse/utils/requestCorrelation.js` creates or reuses a server-side request ID and uses a stricter provider-ID validator; local `src/sse/handlers/chat.js` captures that ID into `clientRawRequest`. Local `open-sse/handlers/chatCore.js` contains no request idempotency cache or client `Idempotency-Key` replay path (the nearby “local idempotency” comment at line 1407 concerns request lifecycle cleanup). The local request-ID/correlation path exists in both the frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c` and `origin/main` `29490b783e83176d4d6a4162f76ee3dc79db66ea`; their only `chatCore.js` differences in this area are a Claude thinking-intent port, unrelated to request identity or replay. No changed behavior here supersedes the prior disposition.

This candidate is therefore **not a correction to an existing DurinDoor behavior**: it adds a client-request deduplication/idempotency contract that DurinDoor does not currently implement. No local defect, regression, or port gap is asserted. No implementation claim is made for provider-specific idempotency behavior.

## Scope and checks

- Compared the actual local `origin/main` object `29490b783e83176d4d6a4162f76ee3dc79db66ea` with frozen train object `32a783d76d45d90bf0517015442f43fadd96106c` using `git show` and `git diff` on the request correlation and chat handler paths.
- Checked `internal/docs/port-reports/omni-review-transport.md` and `internal/docs/port-reports/2026-11-27-full-parity-refresh.md` for the existing disposition and current inventory claim.
- No dependencies were installed; no candidate code, test, service, gateway, or live provider was run.
