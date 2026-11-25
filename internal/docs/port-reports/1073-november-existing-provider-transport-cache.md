# #1073: Existing provider transport and cache comparison

## Scope and source identity

This is a defensive, source-only comparison of the requested OmniRoute first-parent changes with the current DurinDoor integration at `6c69c615d1eb5c087b751b681c68c4b97364baf6`. It does not assess exploitability or exercise provider behavior.

| Change | PR head | Merge commit | First-parent change |
| --- | --- | --- | --- |
| OmniRoute #19286 | `58e6ac2ee956700341e22fe9cdc1097a74557b87` | `2541a5ae8e229c7e1b7b89b572249b1da6c7abc7` | `open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts` |
| OmniRoute #20198 | `4bb013494e496e03dfd2acb037a4760cf982a345` | `dffeb109bcd4e88b906a5322350ba2e93dbf3e02` | `open-sse/executors/bedrock.ts`, `tests/unit/bedrock-client-reuse.test.ts` among other merge changes |

Pinned source references: [#19286 merge diff](https://github.com/cheaper-inference/OmniRoute/commit/2541a5ae8e229c7e1b7b89b572249b1da6c7abc7), [#20198 merge diff](https://github.com/cheaper-inference/OmniRoute/commit/dffeb109bcd4e88b906a5322350ba2e93dbf3e02).

## xAI video request shape

In #19286, `buildXaiVideoPayload` changed a string `image` from a bare string to `{ url: body.image }`, preserved an object-shaped image, and copied `reference_images` when it was an array. The source comment identifies `image` as the start frame and says the bare string shape receives a 422 from xAI. The change is limited to payload mapping in that handler.

The integration’s `open-sse/handlers/videoCore.js` documents and implements a transparent video proxy: it forwards the raw body byte-for-byte (JSON or multipart), selects a provider from the video registry, and does not reshape xAI fields. This is an existing transport path, but not an equivalent payload builder. Consequently there is no local mapping rule to compare with the source `{ url }` conversion, and this review makes no claim that the integration adds or validates reference-image support. Its behavior is body pass-through.

Integration references: `open-sse/handlers/videoCore.js` (`prepareRequest`, `handleVideoProxyCore`); source reference: `open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts` at the #19286 merge above.

## Bedrock client-cache identity

In the #20198 first-parent change, the Bedrock executor replaces its inline SHA-256 derivation with `opaqueTokenFingerprint(credentials.apiKey)`. The existing cache identity remains the JSON tuple `[region, customUserAgent, keyFingerprint]`; the cache lookup, client construction, bounded eviction, and tuple dimensions are unchanged by this patch. The accompanying test checks reuse by region, user agent, and key, and checks that the key material in the cache tuple is represented by the helper’s fingerprint.

The current integration’s `open-sse/executors/bedrock.js` has no client map or cached-client identity: `createClient` returns the injected factory result or constructs a new `BedrockRuntimeClient`. Thus there is no current Bedrock cache key to equate with the source tuple. For limited context, the integration does have `open-sse/utils/memoryKey.js::digestMemoryKey`, a shared SHA-256 helper that domain-separates and length-prefixes parts for in-memory cache identities; this is a different helper and is not wired into Bedrock client reuse. The source comparison here is only the upstream replacement of inline token hashing with its shared fingerprint function while retaining the existing tuple.

Integration references: `open-sse/executors/bedrock.js` (`createClient`), `open-sse/utils/memoryKey.js` (`digestMemoryKey`). Source references: `open-sse/executors/bedrock.ts` and `tests/unit/bedrock-client-reuse.test.ts` at the #20198 merge above.

## Assessment

The xAI change is a source-side request-shape correction within an existing handler; the integration has a separate raw-body forwarding design, so no equivalent field mapping or reference-image feature should be inferred. The Bedrock change centralizes the fingerprint derivation without changing the cache tuple’s identity components; the current integration has no corresponding Bedrock client cache to port or compare as an existing cache identity.
