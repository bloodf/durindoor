# Upstream A2-c — Responses Lite Tools Across Chat Providers — 2026-08-09

Scope: `decolua/9router` commit `d06e0d26`
(`fix(translator): preserve Responses Lite tools across Chat providers`).
Anchors and the deferred list live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

The upstream commit bundles five loosely-related changes. Verified individually
against this fork rather than applied wholesale, because the fork already
carries an independent port of the same custom-tool behavior (OmniRoute #7905)
and a blind application would double-classify custom tools.

| Change | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| `buildUrl` honors the stored `apiType` (`open-sse/executors/base.js`) | PORTED | `getOpenAICompatibleType` already resolved the stored `apiType` first, but `buildUrl` used a bare `this.provider.includes("responses")` substring check. A node created as `openai-compatible-responses-<uuid>` and later edited to Chat Completions kept dispatching to `/responses`. The dashboard exposes exactly that edit (`EditCompatibleNodeModal.js`). | Route through `getOpenAICompatibleType(this.provider, credentials)` so the executor uses the same precedence as the rest of the runtime. Regression test in `tests/unit/compatible-node-api-type-url.test.js`. |
| `resolveOpenAICompatibleApiType` + credential-aware `getTargetFormat` (`open-sse/services/provider.js`) | DUPLICATE | The fork's `getOpenAICompatibleType(provider, credentials)` already prefers the stored `apiType` and falls back to the id substring, and `getTargetFormat` already accepts credentials. | No change. |
| Responses custom (freeform) tools across Chat providers (`translator/request|response/openai-responses.js`) | DUPLICATE | Already ported from OmniRoute #7905: the request translator normalizes `{ type: "custom", name, … }` into a function tool whose single parameter is the raw `input` string, and the response translator re-emits `custom_tool_call` plus the `response.custom_tool_call_input.*` stream events. | No change. Applying the upstream hunks on top would classify the same tool twice. |
| `stripContinuityFields` on the outbound body (`open-sse/handlers/chatCore.js`) | NOT APPLICABLE | The guard exists because upstream's Responses→Chat translator stashes reasoning `encrypted_content` on assistant messages. This fork's `translator/request/openai-responses.js` reads `encrypted_content` from Responses *input items* and never writes it onto an outbound assistant message, so no such field can reach an upstream provider. | No change. Revisit only if a translator starts stashing continuity blobs on messages. |
| Codex `invalid_encrypted_content` recovery | DUPLICATE | `open-sse/executors/codex.js` already detects the error and drops the unverifiable blob while keeping the reasoning item; `open-sse/services/accountFallback.js` classifies it as recoverable. | No change. |

## Verification

- `tests/unit/compatible-node-api-type-url.test.js`: 4 passed.
- Revert proof: restoring the substring check turns exactly one case red —
  "follows the stored apiType over the provider id" — while the three cases the
  old code happened to get right stay green. Restoring the fix returns 4/4.
