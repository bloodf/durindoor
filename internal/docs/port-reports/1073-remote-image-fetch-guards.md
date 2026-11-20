# 1073: Remote-image fetch guard comparison

- Local source: `74bf0277904e28b7a23a6fd583e6234cd612b774`.
- Upstream: merged [OmniRoute #11755](https://github.com/cheaper-inference/OmniRoute/pull/11755), merge SHA `faebf6de5f1f6e4c78c6281ffb175eea21821d95`.
- Disposition: **do not directly port**. The upstream guard-mode branch is structurally absent here; there are applicable local guard improvements for existing image entrypoints and address-policy consistency. This is a static inventory, not a runtime verification or an implementation approval.

Upstream changes `src/shared/network/remoteImageFetch.ts` so `validateRemoteImageUrl` sends `block-metadata` through `parseAndValidateNonMetadataUrl`, alongside the existing `public-only` branch. Its default-mode tests cover initial URLs and redirects. DurinDoor has neither that file nor that mode selector in its image resolver; copying the branch would not reach its callers.

## Local call sites and disposition

| Path | Static evidence and disposition |
| --- | --- |
| Chat prefetch | `open-sse/handlers/chatCore.js:628-642` calls `prefetchRemoteImages` for non-passthrough requests. `open-sse/translator/concerns/prefetch.js:9-16,20-72,81-95` selects formats and image references and calls `fetchImageAsBase64`. **Already guarded**, subject to the address-policy difference below. Formats that accept URLs are a no-op, not a local image fetch. |
| Codex prefetch | `open-sse/executors/codex.js:695-706,728-736` calls the same resolver for image inputs. **Already guarded**, with the same qualification; on failure it retains the URL for the downstream request. |
| Image-generation binary output | `open-sse/handlers/imageGenerationCore.js:119-125,336-342` uses the same resolver for a returned URL in both executor and adapter paths. **Already guarded**, with the same qualification. |
| Cloudflare FLUX.2 multipart reference | `open-sse/handlers/imageProviders/cloudflareAi.js:106-110,129-145,202-205` calls the resolver for remote `image` before constructing the multipart body. **Already guarded**, with the same qualification. |
| Cloudflare JSON image and mask; HuggingFace image-to-image | `open-sse/handlers/imageGenerationCore.js:155-160` invokes the selected adapter's `buildBody` during normal image generation. Cloudflare's non-multipart `buildJsonBody` resolves `image` and mask through `resolveImageInput` (`cloudflareAi.js:40-49,72-92,202-205`); HuggingFace's image-to-image `buildBody` resolves `image` or first `images` entry (`huggingface.js:35-42,74-87`). Both reach `open-sse/handlers/imageProviders/_base.js:59-64`, where `urlToBase64` calls plain `fetch(url)` and reads the body. **Applicable guard improvement:** this path has no visible destination validation or redirect restriction, unlike the guarded resolver. |
| ChatGPT web generated assets | `open-sse/executors/chatgpt-web-http.js:1895-1925,1939-1959,2344-2368` obtains a provider-returned download URL and uses an authenticated TLS client to cache the image. **Out of this port's normal remote-image input lane**: separate provider asset and credential-bearing transport; this inventory makes no claim that it shares the public-image policy or that its redirects are guarded. |

## Address and redirect comparison

`open-sse/translator/concerns/image.js:77-100` accepts HTTP(S), resolves the host, rejects an empty or disallowed DNS result, pins the connection to a validated result and uses `redirect: "manual"`; a non-OK response returns null. `image.js:20-48` rejects the listed private IPv4 ranges and selected IPv6 forms, and `open-sse/config/mediaConfig.js:19-26` lists blocked hostnames. Thus the upstream default-mode fall-through is not present in this resolver, and redirects are refused rather than followed.

The policy is not identical to `src/shared/utils/ssrfGuard.js`: its `assertPublicUrlResolved` applies normalized hostname and numeric IPv6 checks (`:119-155,172-194`), while the image resolver uses its own shorter string-based IPv6 classification (`image.js:20-35`). **Applicable improvement:** use a consistent public-address decision at the normal image fetch entrypoints, including resolved addresses, while retaining connection pinning. The shared `fetchPublic` (`ssrfGuard.js:197-220`) validates each redirect target and bounds hops, but its displayed implementation does not pin DNS to the connection; simply substituting it would not preserve the image resolver's pinning. Preserve either refusal of redirects or bounded validation and connection pinning for every followed hop.

For the unguarded adapter helper, the defensive invariant is that every server-side remote image or mask fetch validates the destination against the intended public-address policy and binds the connection to an approved resolution; redirects are refused or each hop receives the same validation and binding. A mocked ordinary `https://example.com/reference.png` image response is a suitable positive fixture for each affected normal adapter entrypoint. Preserve supported image and mask behavior. No product change is made by this report.

Existing static test evidence includes `tests/unit/image-fetch-hardening.test.js:30-75` for the guarded helper, `tests/unit/cloudflare-flux-reference-image.test.js:63-64` for multipart redirect handling, and `tests/unit/ssrf-guard-hardening.test.js:100-139` for shared redirect validation. Those do not establish coverage of the two unguarded adapter paths or policy equivalence. No tests or network requests to image URLs were run for this inventory.
