# #1073 May catalog and media inventory rows

Scope: compare the public patches pinned below with the current DurinDoor catalog, capability disclosures, search/media routes, and offline fixtures. This is a source and fixture review only; no provider traffic, account setup, or credentials were used.

## Pinned public patches

| PR | PR head | Enclosing merge / exact patch pin | Disposition |
|---|---|---|---|
| [OmniRoute #2030](https://github.com/cheaper-inference/OmniRoute/pull/2030) | `d1ff4a69057e79ea00e893d304550c7672f833ed` | `84955146d0d56db30f8396b7e84f5447adf41234` | Existing behavior; no port |
| [OmniRoute #2176](https://github.com/cheaper-inference/OmniRoute/pull/2176) | `dd51a261e0952ea182a351ffb14f230add89fba1` | `ed1554b7a126ab9287dc99bad219ca0ff3e077bc` | Provider addition; no port |
| [OmniRoute #2196](https://github.com/cheaper-inference/OmniRoute/pull/2196) | `fe48f73831b29ac4a19c1b1a775c6f7381756df3` | `061c0c29fe74997bbb2922981c78c32e3f62abb9` | Endpoint addition; no port |
| [OmniRoute #2377](https://github.com/cheaper-inference/OmniRoute/pull/2377) | `5098d8fd7e06fb605a61bff22aec8e3220056b30` | `985973b35a9668f7fdcc5922599c003bf95617e0` | Provider/mode additions; no port |
| [OmniRoute #2499](https://github.com/cheaper-inference/OmniRoute/pull/2499) | `310ab7a96f9e0a37050cee93a3cd40f3bc9f2411` | `c361b3ca020029d55cf0e1d7da5c4808708283bd` | Narrow existing image-route gap |
| [OmniRoute #2560](https://github.com/cheaper-inference/OmniRoute/pull/2560) | `f5448e3745f2e290ff59d8f481d8914c3d8a7d96` | `17e19fda8c0347aa0b8c3a0cc848d831ba303bf1` | Catalog/provider identifier changes; no port |
| [OmniRoute #2573](https://github.com/cheaper-inference/OmniRoute/pull/2573) | `25c234b7e840587a6af0b6c30f59adce56873fb9` | `9c5bf4cac5e4bffd7f4d96ae0989008d0decb9e4` | Existing capability disclosure; no port |

The catalog, Ollama search, Fireworks prefix, and Kimi vision rows use their named public patch/merge because the supplied heads for #2176, #2196, #2377, and #2573 include release merges or merge-resolution changes. The pins above identify the requested source revisions; the PR-specific patch descriptions below exclude unrelated merge contents.

## Local behavior and evidence

### #2030 — combo context length

The public patch computes a combo's catalog `context_length` as the minimum positive target limit, unless a manual combo limit is set. DurinDoor's v1 catalog builds combo capability metadata from resolved target models in `src/app/api/v1/models/buildModelsList.js`; it publishes positive `contextWindow` as `context_length`. Offline assertions in `tests/unit/buildModelsList-static-alias-map.test.js` cover mixed target contexts, manual context, and fallback resolution. This is equivalent for the installed catalog path, so the proposed change is already covered and is not a missing patch.

### #2176 — Ollama Search

The PR adds the Ollama Cloud search provider and request/response mapping. DurinDoor already declares `ollama.searchConfig` in `open-sse/providers/registry/ollama.js`; the common installed route dispatches registered search providers. `tests/unit/search-providers-omniroute-parity.test.js` checks the `https://ollama.com/api/web_search` destination, bearer header, `{query,max_results}` body, and normalized result/citation using fixtures. This is a provider addition already present locally, not a general search-route fix.

### #2196 — provider-scoped model listing

This PR adds `/api/v1/providers/[provider]/models` and its API documentation. That is a new public endpoint contract, not a correction to catalog model resolution or capability disclosure. The installed model catalog routes already expose unified and connection-filtered catalogs; the current inventory does not establish the new provider-scoped endpoint contract. Treat it as an endpoint addition outside this existing-fix audit; do not infer equivalence from the shared model data.

### #2377 — five content providers

The PR adds five providers and audio/music/video registry entries. Those entries introduce provider, endpoint, model, and media-mode coverage. DurinDoor's provider registry and media handlers are separately inventoried, and existing media fixtures such as `tests/fixtures/media/fal-ai.image.json`, `tests/fixtures/media/gemini.image.json`, and `tests/fixtures/media/deepgram.stt.json` establish only their named adapters' offline request/response shapes. They do not prove the five added providers or the upstream modes. Classify as new catalog/mode coverage rather than a fix to installed routing.

### #2499 — Codex image `n` fan-out

The patch changes image generation to issue multiple upstream requests concurrently when `n` exceeds one, then combines the results. DurinDoor's `open-sse/handlers/imageGenerationCore.js` builds and sends one adapter request for a handler invocation; there is no parallel fan-out over the requested `n`. `tests/unit/image-generation.test.js` exercises the existing adapters and route, while `tests/fixtures/media/fal-ai.image.json` locks the async queue's single-result shape. No existing fixture demonstrates the Codex multi-request behavior. This is the one narrow behavior gap shown by the patch comparison.

Ordinary offline acceptance for a proposed narrow fix: add a fake-fetch unit case for `n: 2` that verifies two independent upstream requests, deterministic aggregation into two normalized `data` entries, preserved prompt/model/output fields, and sensible propagation when one request fails; add a `n: 1` regression case proving the existing single-request response shape remains unchanged. No live Codex call is needed.

### #2560 — Fireworks model identifiers

The PR adds `modelIdPrefix` handling and changes the curated Fireworks models to short IDs which are prefixed before dispatch. DurinDoor's `open-sse/providers/registry/fireworks.js` keeps the complete `accounts/fireworks/models/...` identifiers in its model catalog and uses its existing OpenAI-compatible transport. The local representation therefore already sends fully qualified IDs without a separate prefix mechanism; the PR's code structure is not a demonstrated defect here. No new capability or route fix is established.

### #2573 — Kimi K2.6 vision disclosure

The patch adds `supportsVision` to Kimi K2.6 in several provider definitions. DurinDoor's installed `open-sse/providers/registry/kimi.js` already declares Kimi K2.6 with `supportsVision: true`; other provider-specific K2.6 entries have their own capability metadata and should not inherit it solely by name. The local model catalog derives capability disclosures from registry metadata, and the offline capability/catalog suite is the relevant proof surface. This specific provider disclosure is already present; it does not prove vision support for unrelated K2.6 provider routes.

## Conclusion

Only #2499 demonstrates a narrow change to behavior already routed locally: image requests with `n > 1` are not fanned out by the current handler. #2030 and the Kimi capability row are existing local behavior, #2176's Ollama search is already installed, #2196 is a new endpoint contract, #2377 adds provider/media coverage, and #2560 uses a different catalog representation that already carries complete upstream IDs. Any #2499 implementation should follow the offline acceptance above and the repository's normal behavior-change documentation and unit-test requirements.
