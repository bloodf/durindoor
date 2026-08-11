# Upstream Port Ledger — decolua/9router PR #3170

Scope: credential metadata isolation at request boundary.

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| Request-local metadata leaked onto caller credentials | FIXED | `handleChatCore` cloned only the top level of `rawCredentials`, so any write into `providerSpecificData` (Kiro `profileArn` cache, Vertex `accessToken`/`projectId`) mutated the caller's object. | Clone top level and `providerSpecificData`; preserve `_connection`/`_quotaPreflight` references by NOT doing a recursive clone. |
| Vertex access token and resolved project leaked onto caller credentials | FIXED | `VertexExecutor.execute` now builds request-local `effectiveCredentials = { ...credentials }` before its `accessToken` writes, and clones `providerSpecificData` when caching partner `projectId`. | Port upstream executor isolation; test fixtures drive SA and partner resolution paths. |

## Fork adaptation

DurinDoor stores connection handles (`_connection`, `_quotaPreflight`) on the credentials object at `src/sse/services/auth.js:157-190`. Upstream #3170 only needed a top-level spread; we additionally clone `providerSpecificData` because the Kiro executor writes into `credentials.providerSpecificData.profileArn` at `open-sse/executors/kiro.js:390` and `:406`, and the Vertex executor writes `accessToken` and (for `vertex-partner`) `providerSpecificData.projectId` inside `open-sse/executors/vertex.js:141-163`. A `structuredClone` or recursive clone would detach the shared handle references, so the boundary is intentionally shallow on top + one level for `providerSpecificData`.

## Verification (exact observed behavior)

- RED: against the pre-port source, the `handleChatCore` metadata test fails because `runtimeTransport`, `rawHeaders`, and generated client-session fields leak to its caller. Its Kiro path fails at `expect(credentials.providerSpecificData.profileArn).toBeUndefined()` because the executor writes `arn` into the caller's nested data. The direct Vertex SA and partner executor paths fail at `accessToken` and `providerSpecificData.projectId` respectively.
- GREEN: focused credential-isolation suite passed 4/4; full `tests && npm run test:ci` reported `Raw failures: 0`; lint and production build exited 0; docs integrity passed; `tests/__baseline__/known-fails.txt` was unchanged.
