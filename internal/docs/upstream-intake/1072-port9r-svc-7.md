# 9router intake #1072: port9r-svc-7

- #5447: Deferred. Existing weighted random routing differs from smooth weighted round robin and does not support zero-weight fallback. A complete slice needs persisted weights, deterministic rotation and fallback, dashboard editing, and every combo caller; test cycles, stickiness, zero weights, persistence, and non-chat callers.
- #5466: Deferred. Leaderboard ordering is absent. A complete slice needs a bounded leaderboard fetch and parsing, model matching, combo editor integration and persistence; test parsing, matching, unavailable sources, ordering and storage.
- #5488: Ported in its dedicated commit; assistant string aliases no longer collide with explicit canonical reasoning.
- #5491: Deferred. Existing cooldown selection and status handling differ from upstream, and combo responses still read retry timing from JSON only. A complete slice needs model-specific lock selection, validated status propagation and Retry-After parsing; test multiple accounts, malformed headers and combo fallback timing.
- #5497: Not applicable: closed without merge. No open successor identified.
- #5528: Already in: `open-sse/utils/proxyFetch.js` uses the original native fetch, which accepts native FormData. The upstream multipart regression test passed against this path.
- #5545: Deferred. Key rotation and rename touch authentication, database storage and dashboard state. A complete slice needs atomic key replacement, validation, authenticated endpoints and UI; test old/new key validity, races, permissions and both database engines without rewriting existing secrets.
- #5563: Deferred. DSML parsing is absent and the translator pipeline differs from upstream. A complete slice needs bounded parsing plus stream and non-stream integration including combo aliases; test split tags, malformed payloads, tool validation and existing structured calls.
- #5570: Not applicable: closed without merge; successor [#5574](https://github.com/decolua/9router/pull/5574) is open.
