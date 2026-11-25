# Copilot account contract precedence

Downstream [#2092](https://github.com/bloodf/durindoor/pull/2092) adapted [OmniRoute #15337](https://github.com/cheaper-inference/OmniRoute/pull/15337) (discovered endpoint metadata) and [#15499](https://github.com/cheaper-inference/OmniRoute/pull/15499) (GHE GPT-6 routing). Both source PRs remain merged. Those adaptations remain applicable; this change repairs their interaction with the existing executor-wide escalation cache, rather than porting another upstream change.

A discovered route now takes precedence over learned escalation. Escalation is remembered for the stable connection ID and API host within the executor lifetime; calls without a connection identity still retry immediately but do not share a cached route. Different providers have separate executors. No token material is used as a cache key. The existing GHE family heuristic applies when discovery is absent, and Claude and Gemini retain their existing endpoint restrictions. Request conversion and endpoint discovery cache lifetimes are unchanged.

## Learned routes expire with the routing metadata

A review of [#2116](https://github.com/bloodf/durindoor/pull/2116) narrowed the earlier account-wide reuse to one account and API host, but a same-account refresh could still keep a stale learned route: the account's catalog was refreshed, and the route the gateway had guessed for that account survived that refresh. A learned route is now bound to the generation of the routing metadata it was learned under.

The generation is a nonsecret fingerprint of the account's discovered endpoint contract, computed by `computeCopilotRouteGeneration` in `open-sse/services/copilotEndpointContract.js`. It covers the catalog's own endpoint statements — model ids, declared endpoints, target format and contract version — canonicalized and hashed, so a reordered catalog is not a new generation. No account, host or token material enters it.

- A readable contract yields a content fingerprint. A refreshed catalog that states different routes produces a different generation, which expires the routes learned under the old one.
- No contract at all reads as the `absent` generation. That is a real state rather than a missing value: a learned route stays valid while the account has no metadata, and dies again when metadata appears or disappears.
- A contract that is present but not readable yields no trustworthy generation. No learned route is used against it: the request probes the routes again instead of trusting a guess.
- A refresh that states the same routes keeps the same generation, so the fast path survives a refresh that changed nothing.

Route precedence is unchanged: an operator override first, then the discovered contract, then the GHE family heuristic, and only then a learned route — which is used only while its generation is current. A stale generation is dropped rather than kept for later, so a returning generation cannot resurrect an expired route.

The learned state is bounded by `open-sse/services/copilotLearnedRoutes.js`: at most 64 accounts and hosts, and 64 models per account, with the least recently used entry evicted first. Account and host isolation, the anonymous-call behavior and the explicit-metadata precedence are unchanged.

## Coverage

The offline test covers GitHub and GHE account isolation and actual request body shapes, same-account reuse, refreshed metadata, enterprise host separation and anonymous calls. It also exercises a metadata refresh end to end, offline: a route learned before the refresh is expired by it, the account probes its routes again and learns the route under the new generation, and the same-generation fast path returns on the next call. The learned state bound and the generation rules are covered as well. Existing endpoint-contract tests cover the remaining discovery and Claude/Gemini behavior. The supplied local review fixture exposed the cross-account precedence defect; no live provider requests were used.
