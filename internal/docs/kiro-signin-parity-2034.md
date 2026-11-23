# Kiro upstream comparison (#2034)

Comparison references: CLIProxyAPI `6eb8554f0ede` (its tree has no Kiro-named paths) and OmniRoute `5ffa68e83544`. This is a partial pass, not a parity certification. Identity cloaking and detection evasion are outside its scope.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Estimated stream token usage | OmniRoute `open-sse/executors/kiro.ts`, `ensureKiroUsage` | Ported here: context percentage estimates total tokens; completion is subtracted from that total for prompt usage. Estimates remain marked as such and credits are preserved. |
| Device registration, authorization and polling | OmniRoute `src/lib/oauth/services/kiro.ts` | Initial comparison found matching endpoints and device grant; complete error and configuration comparison remains pending. |
| Social authorization and exchange | OmniRoute `src/lib/oauth/services/kiro.ts` | Initial comparison found matching redirect and token endpoint; complete PKCE and error comparison remains pending. |
| External IdP refresh | OmniRoute `src/lib/oauth/services/kiro.ts` | Both use a form-encoded refresh grant; local response validation and proxy routing differ. Complete branch comparison remains pending. |
| Runtime endpoint fallback | OmniRoute `open-sse/executors/kiro.ts`, `execute` | Both have fallback machinery; status, body and authentication-specific behavior still requires comparison. |

Remaining work: compare OAuth client configuration, scopes, PKCE and all exchange/refresh errors; account and profile lookup; request translation and envelope; non-cloaking headers, retries and endpoint selection; quota/rate-limit handling; model discovery and mapping; and stream, response and error classification. Port and test each applicable gap through its actual route. Inspect the provider configuration separately and document any needed `src/lib/oauth/providers.js` change without editing that file. The pinned CLIProxyAPI tree also needs a function-level search for any Kiro implementation under generic filenames.
