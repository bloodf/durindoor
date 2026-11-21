# #1073: late-June existing model resolver residuals

## Scope and method

Compared the exact public PR-head commits below against their immediate parents; the enclosing merge commits are recorded as integration pins. This avoids attributing unrelated merge contents to a PR. Review is limited to current model resolution, routing, and model-scope behavior. Runtime identity and admission invariants remain separate from provider/model additions, profile or account routing, and sign-in changes. Access-check conclusions are static defensive source comparisons only.

The already integrated trimming and canonical local routes remain intact. The relevant local resolver continues to route provider prefixes through its reserved-prefix set, trim redundant compatible-node prefixes, and use connection/model-scoped fallback logic where already defined.

## OmniRoute #4656 — compatible-node prefix shadowing

- PR: [#4656](https://github.com/cheaper-inference/OmniRoute/pull/4656)
- Exact head: [`74c423ae21375eeb1a87eb9700bfa9dd3a74c365`](https://github.com/cheaper-inference/OmniRoute/commit/74c423ae21375eeb1a87eb9700bfa9dd3a74c365)
- Enclosing merge: [`d2aa67a11cceb59e56416ff13809f2383df8d66a`](https://github.com/cheaper-inference/OmniRoute/commit/d2aa67a11cceb59e56416ff13809f2383df8d66a)

The patch reserves built-in provider IDs and aliases before checking compatible-node prefixes, while keeping internal node-ID addressing and noncolliding custom prefixes available. Current `src/sse/services/model.js` builds `RESERVED_PROVIDER_PREFIXES` from the provider registry and local aliases, and `getModelInfo` skips compatible-node prefix resolution for reserved prefixes. The focused `tests/unit/model-routing.test.js` cases verify that a compatible node with prefix `cf` cannot take `cf/@cf/black-forest-labs/flux-2-klein-9b` from `cloudflare-ai`, and that an `oct` compatible-node prefix still resolves to its node.

**Disposition: already covered.** The local guard is at least as broad as this patch for provider aliases, and local fixtures cover the collision and pass-through cases. No additional routing or access behavior is indicated by this PR.

## OmniRoute #4825 — bare model to selected connection default

- PR: [#4825](https://github.com/cheaper-inference/OmniRoute/pull/4825)
- Exact head: [`f353b473acfd1fa2b94c62e0cd8ab531df777367`](https://github.com/cheaper-inference/OmniRoute/commit/f353b473acfd1fa2b94c62e0cd8ab531df777367)
- Enclosing merge: [`12a621c1f3979c916c7578047f9c8de080814850`](https://github.com/cheaper-inference/OmniRoute/commit/12a621c1f3979c916c7578047f9c8de080814850)

The exact patch adds a pure resolver that substitutes the selected connection’s `defaultModel` only when the raw requested model is bare (contains no `/`), then uses the result for chat and embeddings request bodies, accounting, and response metadata. A slash-qualified explicit model is preserved. In the current local request path, `src/sse/services/auth.js` does not surface the selected connection’s `defaultModel` in the returned credentials, and `src/sse/handlers/chat.js` has no equivalent bare-model substitution before dispatch. Existing `defaultModel` references in provider setup, health probes, and CLI settings do not establish this request behavior. No focused fixture currently demonstrates this chat/embedding resolution contract.

This behavior is a narrow request-model resolution gap. It does not justify changing connection selection, account identity, quota/admission, fallback scope, authentication, sign-in, or provider/model inventory. The PR itself does not establish a new provider or profile.

**Disposition: narrow candidate gap; ordinary offline acceptance is appropriate if selected for implementation.** A focused unit fixture should prove: (1) a bare alias-resolved model is replaced by the selected connection default before upstream dispatch and model accounting/metadata use that effective model; (2) slash-qualified explicit requests remain unchanged; (3) absent or empty defaults preserve existing resolution; and (4) the resolver does not alter selected connection identity, admission decisions, or fallback model scope. Do not use live provider traffic or credentials for acceptance.

## OmniRoute #4869 — combo ID and case-insensitive name lookup

- PR: [#4869](https://github.com/cheaper-inference/OmniRoute/pull/4869)
- Exact head: [`92afe8d4be7e126d2b041201cad66d0061161ed7`](https://github.com/cheaper-inference/OmniRoute/commit/92afe8d4be7e126d2b041201cad66d0061161ed7)
- Enclosing merge: [`b90b52abe3e1792928d1e71fdca6df39a7ea99f3`](https://github.com/cheaper-inference/OmniRoute/commit/b90b52abe3e1792928d1e71fdca6df39a7ea99f3)

The exact patch preserves exact-name priority, then adds combo-ID and case-insensitive-name fallbacks for an OpenCode dispatch shape. Locally, `src/lib/db/repos/combosRepo.js:getComboForModel` already tries an exact name and then a case-insensitive name with deterministic ordering; this covers the lowercased display-name behavior. It does not query combo ID. `src/sse/services/model.js:getModelInfo` routes combo requests through `getComboForModel`, so a stored ID alone is not resolved on that path. Current local evidence includes existing combo-name routing exercised throughout the unit suite, including `tests/unit/combo-patches.test.js`; it does not establish ID lookup or a dedicated case-insensitive stored-name fixture at the repository layer.

**Disposition: case-insensitive name behavior covered; combo-ID routing is a narrow candidate gap.** Ordinary offline acceptance, if selected, should exercise the repository and model-resolution path with a stored ID, verify exact name still wins, verify mixed-case/lowercased name fallback, and verify unknown IDs/slugs remain unresolved. Preserve existing combo membership, allowed-connection, invariant, and admission checks; resolving an identifier must not grant access or change a combo’s scope. This is resolver behavior only, not a new provider, profile, account route, or sign-in path.
