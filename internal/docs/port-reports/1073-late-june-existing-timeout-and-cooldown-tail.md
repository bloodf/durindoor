# #1073 late-June existing timeout and cooldown tail

## Scope and pins

Three pinned OmniRoute PRs were compared against the current DurinDoor timeout provenance, the bounded model/account cooldown path, and the existing Antigravity quota-family handling. This is a documentation audit only: no product code, tests, workflows, credential access, provider traffic, or paid APIs were used.

| PR | Exact PR head | Enclosing merge | Patch base | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #5064](https://github.com/cheaper-inference/OmniRoute/pull/5064) | `15320ecd27be5310a6c03694aa0949c61d860d3d` | `1b041d8accfb29277f6351834fcbc41d05ee209b` | `a835192a9c26e39e5332a2910c8fd16b72adfd15` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/15320ecd27be5310a6c03694aa0949c61d860d3d) |
| [OmniRoute #5093](https://github.com/cheaper-inference/OmniRoute/pull/5093) | `188288453a7a35251039b4cbcbcfaf0b3ee2d3af` | `09ac61589482877be25be2ce5e184fa0cde9f8da` | `9fd630c34b0c484b76e862a556b6a22e3dbe99f9` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/188288453a7a35251039b4cbcbcfaf0b3ee2d3af) |
| [OmniRoute #5180](https://github.com/cheaper-inference/OmniRoute/pull/5180) | `5fac806c4b54fbb0e328bf971c91c62f0c8888a0` | `d878953b7d73a96bc5fa96d8c075198036c8b213` | `422b7bd3cf42142ab221d92c83801bc7e1166be4` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/5fac806c4b54fbb0e328bf971c91c62f0c8888a0) |

Patch-base note. Each enclosing merge in this window is a single-parent squash commit whose tree diff is byte-identical to `base..head` (stable patch-id equality was confirmed for all three). No unrelated PR content rides along in any of the three merges, so the head diff is the exact public patch for each PR and no merge-only hunks had to be excluded. #5180's patch base already contains #5093's `accountFallback` change, so #5180 is read on top of that state. #5064's head is the changelog commit of its patch series and its diff against the base carries the whole change, including the new `open-sse/handlers/chatCore/cooldownClassification.ts` module.

## Current local behavior

### Where a deadline comes from (timeout provenance)

DurinDoor's own deadlines are created in the fork's transport and response layers, and each one is tagged by the layer that raised it. Nothing is inferred from upstream error text.

- **Per-connection operator timeout.** [`src/lib/providers/requestTimeout.js`](../../../src/lib/providers/requestTimeout.js) reads `providerSpecificData.timeoutMs` bounded to 1..86,400,000 ms. It drives the non-streaming body-read deadline ([`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js)) and the streaming stall watchdog ([`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js)).
- **Fetch/header deadline.** [`open-sse/executors/base.js`](../../../open-sse/executors/base.js) arms the connect timer from `policy.headerTimeoutMs`, else the provider transport `timeoutMs`, else `FETCH_CONNECT_TIMEOUT_MS` (60s default). When that timer wins the race, the executor tags the error `errorKind = "connect_timeout"` ([`base.js`](../../../open-sse/executors/base.js)), and for Antigravity additionally sets `antigravityPreResponseTimeout = true` ([`base.js`](../../../open-sse/executors/base.js)).
- **Body-read deadline.** `PROVIDER_BODY_TIMEOUT_MS` / `RESPONSE_BODY_TIMEOUT_MS` (120s default) produce `BodyReadTimeoutError` ([`open-sse/utils/bodyTimeout.js`](../../../open-sse/utils/bodyTimeout.js)), which is surfaced as HTTP 504 in the non-streaming path ([`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js)) and in the forced SSE→JSON path ([`open-sse/handlers/chatCore/sseToJsonHandler.js`](../../../open-sse/handlers/chatCore/sseToJsonHandler.js)).
- **Combo per-member deadline.** `COMBO_MODEL_TIMEOUT_MS` (0 = off) or the per-combo `timeoutMs` aborts one member attempt ([`open-sse/services/combo.js`](../../../open-sse/services/combo.js)); the timed-out member is treated as a deadline miss and the combo falls to the next member ([`combo.js`](../../../open-sse/services/combo.js)).
- **Antigravity header deadline.** The Antigravity-specific tag above is read in [`chatCore.js`](../../../open-sse/handlers/chatCore.js) and mapped to 504 instead of 502.

### How a failure reaches the account layer

- [`chatCore.js`](../../../open-sse/handlers/chatCore.js) attaches `transportFailure` (`connect_timeout` | `network`) to the failure result. This is the fork's own transport classification: no HTTP response was produced by any hop. A bare 502/503/504 is never treated as such proof ([`open-sse/config/errorConfig.js`](../../../open-sse/config/errorConfig.js)).
- [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js) returns immediately, without any cooldown, for a caller abort (`499`, an aborted request signal, or a local stream-lifecycle error).
- [`chat.js`](../../../src/sse/handlers/chat.js) gives Antigravity its own policy: an Antigravity 504 rotates to a sibling connection and writes no cooldown.
- [`chat.js`](../../../src/sse/handlers/chat.js) calls `markAccountUnavailable` with the status, the normalized rate-limit evidence, and `transportFailure`.
- [`src/sse/services/auth.js`](../../../src/sse/services/auth.js) applies the relay/hop exemption: a proven transport failure (`isRelayGatewayFailure`, [`open-sse/services/accountFallback.js`](../../../open-sse/services/accountFallback.js)) skips the credential cooldown **only when the failing account is the single account that could still serve this request**. With a usable sibling, the account keeps its cooldown so rotation has a fallback.
- [`auth.js`](../../../src/sse/services/auth.js) then applies the ordinary classification. Unmatched client 4xx failures are request-scoped and write no cooldown ([`accountFallback.js`](../../../open-sse/services/accountFallback.js)); any other unmatched status, including a bare 504, takes the generic transient cooldown of 30s ([`accountFallback.js`](../../../open-sse/services/accountFallback.js)).

### Bounded model and account cooldown

- Fixed bounds: transient cooldown 30s, quota backoff 2s base with a 5-minute maximum and a level cap of 15, empty-content cooldown 7 minutes, free/free-tier static cap 60s, Kiro/Amazon-Q reset probe cap 24 hours, and a hard 7-day ceiling on any provider-reported or configured cooldown ([`open-sse/config/errorConfig.js`](../../../open-sse/config/errorConfig.js), [`src/sse/services/auth.js`](../../../src/sse/services/auth.js)).
- [`auth.js`](../../../src/sse/services/auth.js) resolves a per-provider reset cap and [`auth.js`](../../../src/sse/services/auth.js) clamps the persisted cooldown to it, so a model lock is never written with an unbounded deadline.
- The atomic writer is the account-ownership boundary: [`src/lib/db/repos/connectionsRepo.js`](../../../src/lib/db/repos/connectionsRepo.js) rejects any cooldown outside 0..7 days, owns the `modelLock_<scope>` field, the availability marker, and the stored reason under one transaction, and refuses to demote a durable reauth. The compatibility writer in [`auth.js`](../../../src/sse/services/auth.js) is the fallback path only.
- The lock scope is the exact canonical model: `modelLock_<model>` with `modelLock___all` reserved for account-wide locks ([`open-sse/services/accountFallback.js`](../../../open-sse/services/accountFallback.js), [`open-sse/services/fallbackScope.js`](../../../open-sse/services/fallbackScope.js)).
- Quota exhaustion state is owned separately from the cooldown: explicit exhausted-quota evidence is persisted by [`src/shared/services/providerRateLimitEvidence.js`](../../../src/shared/services/providerRateLimitEvidence.js), and selection-time gating is owned by the quota preflight. A cooldown never fabricates quota exhaustion.
- There is **no operator-configurable model-lockout ceiling** in this tree. The upstream `src/lib/resilience/modelLockoutSettings` module and its `maxCooldownMs` setting have no local counterpart, so the local bounds above are the whole bound story.

### Antigravity quota-family distinctions

- The Antigravity/Google quota source reports quota **per exact model**: each row is keyed `model:<modelId>` ([`open-sse/services/quota/providers/google.js`](../../../open-sse/services/quota/providers/google.js)), and the provider payload itself carries per-model `quotaInfo` (fixtures: [`tests/unit/antigravity-quota-gemini-3.6.test.js`](../../../tests/unit/antigravity-quota-gemini-3.6.test.js), [`tests/unit/antigravity-quota-gemini-3.8.test.js`](../../../tests/unit/antigravity-quota-gemini-3.8.test.js)). The Antigravity catalog carries both `gemini-*` and `claude-*` model rows ([`open-sse/providers/registry/antigravity.js`](../../../open-sse/providers/registry/antigravity.js)).
- The catalog has an explicit `quotaFamily` field with the default `"normal"` ([`open-sse/providers/models/schema.js`](../../../open-sse/providers/models/schema.js)), and only Codex declares a family (`review`) ([`open-sse/providers/registry/codex.js`](../../../open-sse/providers/registry/codex.js)). `getModelQuotaFamily` reads that declared field ([`open-sse/config/providerModels.js`](../../../open-sse/config/providerModels.js)); it never derives a family from a model id.
- The provider quota configuration states the rule explicitly: quota families and provider resource names "must never be inferred with substring matching from an untrusted passthrough model ID" ([`open-sse/config/providerQuota.js`](../../../open-sse/config/providerQuota.js)). Antigravity declares no `quotaFamilies` and no `runtimeScopes` ([`open-sse/config/providerQuota.js`](../../../open-sse/config/providerQuota.js)), so an Antigravity quota exhaustion is model-scoped, not account-wide ([`auth.js`](../../../src/sse/services/auth.js)).
- The Antigravity optimistic-429 strike breaker is keyed per `(connection, model)` ([`chat.js`](../../../src/sse/handlers/chat.js)), and the reactive quota refresh on a 409 or a non-authoritative 429 reselects on a fresh provider-side blocker ([`chat.js`](../../../src/sse/handlers/chat.js)).

### Fixture evidence

- [`tests/unit/relay-account-cooldown-2068.test.js`](../../../tests/unit/relay-account-cooldown-2068.test.js) pins the transport-provenance vocabulary ([lines 95-124](../../../tests/unit/relay-account-cooldown-2068.test.js)), the single-eligible-account cooldown skip ([lines 156-170](../../../tests/unit/relay-account-cooldown-2068.test.js)), the deliberate multi-account cooldown ([lines 195-216](../../../tests/unit/relay-account-cooldown-2068.test.js)), and the executor→account-layer provenance carry ([lines 432-457](../../../tests/unit/relay-account-cooldown-2068.test.js)). It also pins that a client abort is never a relay failure.
- [`tests/unit/omni-antigravity-timeout.test.js`](../../../tests/unit/omni-antigravity-timeout.test.js) pins the Antigravity header-deadline tag (`connect_timeout` plus `antigravityPreResponseTimeout`), the caller-abort distinction, and that an upstream 504 is returned without relabeling it as a local deadline.
- [`tests/unit/port-3220-nonstreaming-read-timeout.test.js`](../../../tests/unit/port-3220-nonstreaming-read-timeout.test.js) pins that the body-read deadline surfaces as a real HTTP 504.
- [`tests/unit/model-lock-precedence.test.js`](../../../tests/unit/model-lock-precedence.test.js) and [`tests/unit/provider-fallback-state-repository.test.js`](../../../tests/unit/provider-fallback-state-repository.test.js) pin model-lock scope precedence and the atomic fallback-state writer as the lock owner.
- [`tests/unit/antigravity-capacity-fallback.test.js`](../../../tests/unit/antigravity-capacity-fallback.test.js) pins that an Antigravity quota lock survives account selection and lets a secondary account serve the request.

All of these are ordinary offline fixtures: no credentials, no provider traffic.

## Dispositions

### #5064 — narrow port recommended (self-deadline provenance)

The pinned patch tags the fork's own deadline timeouts (fetch-start `TimeoutError`, body `BodyTimeoutError`) as a 504 `upstream_timeout`, and skips the connection cooldown for them through a new `isSelfInflictedUpstreamTimeout(status, errorType, provider)` helper, with Antigravity explicitly excluded so it keeps its own policy.

DurinDoor already owns the same distinction, but through a different channel and with a narrower reach:

- the fork's own connect deadline is tagged `connect_timeout` and reaches the account layer as `transportFailure`, and the relay/hop exemption then skips the credential cooldown when that account is the only one that could still serve the request;
- the combo per-member deadline produces a 499/abort and therefore already writes no cooldown;
- the Antigravity header deadline keeps its own rotation-without-cooldown policy, matching the upstream exclusion.

One narrow gap is demonstrated. The **body-read deadline** — the fork's own 120s body bound, or the per-connection operator timeout that overrides it — is surfaced as a plain 504 with no provenance marker, so the account layer classifies it as an unmatched status and cools a healthy connection down. Offline evidence with the current modules: `checkFallbackError(504, "Provider response body timed out", 0, "claude")` returns `{ shouldFallback: true, cooldownMs: 30000 }`, and `isRelayGatewayFailure(504, { transportFailure: null })` is `false`. The result is a 30-second transient cooldown, a `modelLock_<model>` write, and an availability marker on a connection that answered with headers and was still streaming a slow-but-healthy body.

The recommended port is narrow and provenance-based, in the same shape as the existing relay rule: mark the fork's own body-read deadline in the layer that raises it, carry that marker to the account layer, and suppress only the credential cooldown for it. It must not be implemented by matching the error text — the local relay rule exists precisely because upstream error text is not proof.

Boundaries the port must preserve:

- **Account ownership.** The atomic fallback-state writer stays the only lock writer; the port only decides whether a lock is written for this one failure class.
- **Quota behavior.** A 429 with explicit exhausted evidence keeps its persisted evidence and its lock; the port applies only to the fork's own deadline. The Antigravity strike breaker and reactive quota refresh are untouched.
- **Caller-abort behavior.** 499, an aborted request signal, and local stream-lifecycle errors keep writing nothing.
- **Antigravity.** The existing Antigravity pre-response-timeout policy (rotate to a sibling, no cooldown) is unchanged.

One deliberate divergence from upstream must be confirmed by the owner before implementation: upstream's skip also stops account rotation, because it returns `shouldFallback: false`. The local recommendation keeps the existing rotation to a sibling account when one exists, because the local relay rule deliberately keeps the cooldown in exactly that case, so the failing account is benched instead of being re-selected ([`relay-account-cooldown-2068.test.js`](../../../tests/unit/relay-account-cooldown-2068.test.js)). The port therefore suppresses the cooldown, not the rotation.

The upstream module path (`open-sse/handlers/chatCore/cooldownClassification.ts`) has no local counterpart and does not need one: the local tree is JavaScript and already has a natural home for the marker in the response handler that raises it.

### #5093 — no port on the audited cooldown and quota-cutoff surface

The pinned patch carries three changes.

1. **Model lockout honors the configured `maxCooldownMs` ceiling.** The upstream fix removes a bug where a *configured* ceiling was ignored. DurinDoor has no operator-configurable model-lockout ceiling: there is no resilience-settings module and no `maxCooldownMs` setting, so there is no configured ceiling to ignore. The local bound is structural instead — the per-provider reset cap, the 7-day hard ceiling, and the atomic writer's rejection of any cooldown outside 0..7 days. This is a missing settings surface, not a residual of this patch, so it is not ported here.
2. **Stored quota-cutoff values must be booleans.** DurinDoor has no stored resilience quota-cutoff toggle to coerce. Where it does read stored settings booleans, it already coerces strictly through `isBoolean` rather than truthiness ([`open-sse/config/quotaSelection.js`](../../../open-sse/config/quotaSelection.js), [`open-sse/config/quotaSelection.js`](../../../open-sse/config/quotaSelection.js)). Nothing to harden.
3. **Gemini audio MIME normalization.** This component is on the translator surface, not the timeout/cooldown/quota surface audited here, so it is recorded rather than dispositioned by this audit. For the record, the local Gemini content converter does not validate the `input_audio.format` value ([`open-sse/translator/formats/gemini.js`](../../../open-sse/translator/formats/gemini.js)): a non-string format yields `audio/123`, an uppercase format yields `audio/MP3`, and a `data:audio/mp3;base64,` payload is forwarded verbatim as the base64 `data` field instead of being stripped. Those are ordinary offline observations against the current module, and the corresponding ordinary offline acceptance is stated in the Acceptance section below for the translator-surface audit to pick up.

No cooldown, quota-state, or quota-cutoff gap is demonstrated by this PR in this tree.

### #5180 — no port as written

The pinned patch adds an Antigravity quota-family classifier that maps `gemini-*` and `google/gemini-*` model ids to a Gemini bucket and `claude-*` / `cloud-*` / `anthropic*` ids to a Claude bucket, rewrites the model lock key to `family:gemini` / `family:claude` for Antigravity only, and adds a quota-scope label to the model-only quota warning. Its own test asserts that every other provider keeps exact-model scope.

DurinDoor already distinguishes Antigravity quota families, but by declaration rather than by inference, and its quota source is per exact model:

- The quota rows are keyed `model:<modelId>` ([`google.js`](../../../open-sse/services/quota/providers/google.js)), because the Antigravity/Google quota payload reports quota per model. Nothing in the local evidence shows that upstream enforces one shared bucket per family.
- The catalog carries an explicit `quotaFamily` field, and the provider quota configuration requires exact aliases and forbids substring inference over untrusted model ids ([`providerQuota.js`](../../../open-sse/config/providerQuota.js)). The upstream classifier infers the family by substring matching on the requested model id, which is exactly the shape that rule forbids.
- The local Antigravity lock is model-scoped by design, since Antigravity declares no `runtimeScopes` ([`providerQuota.js`](../../../open-sse/config/providerQuota.js)), and the existing offline fixture shows a model lock surviving account selection while a secondary account serves the request ([`antigravity-capacity-fallback.test.js`](../../../tests/unit/antigravity-capacity-fallback.test.js)).

The narrow local gap is real but not the upstream remedy: an Antigravity quota exhaustion on one Gemini model locks that exact canonical model, so a sibling Gemini variant of the same family stays selectable and each attempt burns a request. Closing that gap here would mean adding a catalog-declared Antigravity family plus an explicit provider-quota alias — a new declared capability in the registry and quota configuration, not a port of a substring classifier.

The log-label part of the patch has no local counterpart branch: the local equivalent is the account-layer log that already names the locked scope ([`auth.js`](../../../src/sse/services/auth.js)).

## Acceptance

#5064 is the only demonstrated gap on the audited timeout/cooldown/quota surface, and its acceptance is ordinary offline coverage with synthetic bodies and fake timers — no credentials, no provider traffic, no live quota access:

- A stalled response body on the non-streaming path must produce a 504 that carries the fork's own deadline provenance, and the account layer must write **no** `modelLock_*` field, **no** availability marker, and no cooldown for it.
- A genuine upstream 504 (the provider answered 504 itself) must still write the model lock and the cooldown, so the port cannot swallow a real provider failure.
- The Antigravity pre-response timeout must keep its current behavior (rotate to a sibling, write no cooldown), so the Antigravity exclusion survives the port.
- A client abort (499 or an aborted request signal) must still write nothing, and a 429 carrying explicit exhausted-quota evidence must still persist its quota evidence and its lock.

The out-of-surface Gemini audio MIME observation recorded under #5093 carries its own ordinary offline acceptance for the translator-surface audit: a translator test that feeds `input_audio` with a non-string `format`, an uppercase `format`, and a `data:`-prefixed payload into the Gemini content converter and asserts the emitted `inlineData.mimeType` is a normalized `audio/...` type and that the `data:` prefix is stripped from the base64 payload.

No other change is proposed by this report. #5093's cooldown and quota-cutoff components and all of #5180 require no product change, no new test, and no acceptance beyond the fixture evidence cited above.
