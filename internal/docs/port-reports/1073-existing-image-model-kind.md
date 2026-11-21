# 1073: existing image model kind disposition

Source: https://github.com/cheaper-inference/OmniRoute/pull/18683, merged, pinned `e3a983140b4cf15d37558ecf70c5fb4a22f86165`. Disposition: already covered locally. No production code changed.

## What the source changed

The final source diff touches one function, `isImageOnlyModel` in `open-sse/config/imageRegistry.ts`, plus a changelog fragment and a test. In that fork an image-registry model counted as chat-capable whenever the chat catalog also listed it. Leonardo and Ideogram list their image models in the chat catalog only so the provider page can show them. The dashboard model test therefore sent `leonardo/phoenix` a chat request (answered 404 "Endpoint not found") and `/v1/chat/completions` forwarded it upstream. The fix classifies a provider's image model as image-only when every chat-catalog model of that provider is an image model.

## Why DurinDoor needs no change

DurinDoor has no separate image registry whose membership is compared to the chat catalog. Classification is declared per model in the provider registry, so the source's failure mode cannot occur here:

- `open-sse/providers/registry/leonardo.js` (`phoenix`, `sdxl`) and `ideogram.js` (`V_3`, `V_2A`) declare `kind: "image"` on every model. Provider level `serviceKinds: []` and `hiddenKinds: ["image"]` keep them out of image provider pickers until an adapter exists.
- Chat selection: `isImageOnlyModel(provider, model)` in `src/sse/handlers/chat.js` resolves the registry row by id or alias and returns true for `kind === "image"`. The chat handler rejects it with a 400 before credentials or dispatch. `isChatProvider` in `open-sse/providers/chatCapability.js` is false for both providers (no transport, no `llm` kind), so `isNonChatModel` is a second guard. The `/v1/models` chat listing filters by per-model kind.
- Model test path: `src/app/api/models/test/ping.js` and `src/app/api/providers/[id]/test-models/route.js` pick the probe from `model.kind`. Image kind goes to `/api/v1/images/generations`; chat is never sent.
- Image operation and errors: neither provider has an adapter in `open-sse/handlers/imageProviders/index.js`. `handleImageGenerationCore` answers 400 `Provider '<id>' does not support image generation`, after the existing missing-`prompt` check. That precise media error is preserved.

Mixed providers keep their behavior. `cloudflare-ai` image rows are image-only and its llama rows are chat-capable. `openai/gpt-4o` is chat-capable. An unregistered model id is not classified as image-only.

## Rejected alternatives

Porting the "all chat models are image models" rule would add a second classification source that duplicates the per-model `kind`. No provider, model, page or endpoint was added, and no registry row was edited.

## Evidence

`tests/unit/omni-existing-image-model-kind.test.js` (offline, fake fetch only, no credentials or network):

- registry rows are exactly the four existing models, all `kind: "image"`, with aliases `leo` and `ideo`;
- `isImageOnlyModel` is true for each by provider id and alias, and a sweep over every registry row shows image-only matches the declared kind exactly;
- `isChatProvider` is false for both providers; mixed providers stay chat-capable;
- no adapter exists, both providers stay hidden from image pickers, and image generation returns the precise 400 error;
- `pingModelByKind` with the registry kind calls only `/api/v1/images/generations` and surfaces `HTTP 400: ... does not support image generation`.

Mutation check: removing `kind: "image"` from Leonardo's `phoenix` makes three of the eleven tests fail (registry rows, chat classification, model-test path); the file was restored.

Limits: the chat catalog assertion (`buildModelsList(["llm"])`) is a negative guard against a default empty data directory and did not fail under the mutation, so it is not the primary proof. Nothing here shows that a Leonardo or Ideogram account works; there is no adapter and no live traffic was used.
