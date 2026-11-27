# Leonardo native reference-image edits (staged), 2026-11-27

Issue: #2034. The earlier Leonardo stage (`native-leonardo-video-image`) left out the source's reference-image edit flow because it needed a separate security review. The owner has now authorized implementing it, tested with closed mocks only. This stage adds a private, unregistered edit adapter. Production wiring is a separate serial step, described in `registration.json` (`registrationBatch: "batch03"`).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The pinned files were read with public GET requests only.

- `open-sse/handlers/imageGeneration/providers/leonardo.ts`
  - `LEONARDO_EDIT_INIT_STRENGTH = 0.3`.
  - `LEONARDO_INIT_IMAGE_EXTENSIONS` maps `image/png` to `png`, `image/jpeg` and `image/jpg` to `jpg`, and `image/webp` to `webp`.
  - `uploadLeonardoInitImage` (lines 58-85):
    1. `POST https://cloud.leonardo.ai/api/rest/v1/init-image` with `Content-Type: application/json`, `Authorization: Bearer <key>` and the body `{ extension }`.
    2. Reads `uploadInitImage.{ id, url, fields }` from the answer, where `fields` is a JSON string.
    3. Appends each field, then `file` (the bytes, filename `init`).
    4. Encodes the form through `new Response(form)` and POSTs the bytes to `url` with only the boundary `Content-Type` header. The Leonardo key is not sent.
  - `handleLeonardoImageGeneration` (lines 88-123): with an init image, the ordinary generation body gains `init_image_id` and `init_strength`, and the generation is polled as usual.
- `src/app/api/v1/images/edits/route.ts`, `leonardo-image` branch: only one reference image is allowed. The handler gets `{ prompt, size }`, and the model goes through `resolveLeonardoModelId`.

## What is staged

`open-sse/services/providerParity/native-leonardo-image-edits/`:

- `config.js`: source constants and gateway bounds.
- `request.js`: parses multipart and JSON edit requests into the supported subset. It runs before any network call.
- `storage.js`: validates the upload ticket and the storage URL, resolves and pins DNS, checks the socket peer, and pre-encodes and uploads the form.
- `edit.js`: `createLeonardoImageEditAdapter().edit({ model, formData, jsonBody, credentials, signal, log })`.
- `index.js` and `registration.json`.

Reused read-only from `native-leonardo-video-image`:

- model ids (`resolveLeonardoImageModelId`)
- size rules (`resolveLeonardoImageSize`, called with `{ size }` only, as the source edit branch does)
- `boundedFetch`, `redirectState`, `readJsonObject` and `refusedAnswer`
- `leonardoImageResult` and `runLeonardoJob`, for the generation and its poll

That module and its tests are unchanged.

## Supported subset

- Exactly one reference image, sent as a multipart file or a base64 `data:` URI (`image`, or a one-element `images`). The image must be PNG, JPEG or WebP judged by its magic bytes, and at most 10 MiB. If a specific declared type is given, it must match the bytes. The sniffed type and the source extension are sent.
- `model`: `phoenix`, `sdxl` or a platform-model UUID. `size`: `WxH`, from 32 to 1536 and a multiple of 8, defaulting to 1024x1024. `n` must be 1, `response_format` must be `url`, and `user` is accepted but not sent.
- The result is the generation's public https image URL. It is never downloaded. The source answered `b64_json`.

## Refused before any upload

These are refused before any call to Leonardo or storage:

- masks
- more than one reference
- remote reference URLs (never fetched)
- `file_id` references
- GIF or other formats, truncated or mislabelled files
- `width` and `height` fields, which the source edit branch does not forward
- `n > 1`, streaming and `b64_json`
- unknown fields
- a missing key
- a connection proxy (see below)

## Security hardening (fork deviations)

- The key goes only to `https://cloud.leonardo.ai`. The storage request carries only `Content-Type`. No caller header is forwarded.
- The ticket is validated strictly:
  - `id` must have a safe shape.
  - `fields` must be a JSON string holding 1-32 scalar fields. Names must have a safe shape, `file` is not allowed as a name, and values must have no CR, LF or NUL and be at most 8 KiB.
- The storage URL must be `https:` on the default port, with no userinfo, and its host must not be blocked by `src/shared/utils/ssrfGuard.js` `isBlockedHost`. That rejects localhost, `.internal`, `.local`, private, loopback, link-local and metadata hosts, IPv4-mapped forms, and similar.
- DNS is resolved once (`all: true`). Every answer must pass `isBlockedHost`. The undici connection is pinned to those answers, so a second lookup cannot rebind it. The connector refuses blocked or unpinned literal hosts and destroys a socket whose peer address is not a pinned public address.
- Redirects are refused (`redirect: "manual"`) on the init-image request and on the storage upload.
- Every phase is bounded and abortable: init-image (30 s), DNS (10 s), upload (60 s), and the generation submit and poll (existing bounds). One deadline (300 s) covers the whole edit.
- The upload uses undici's `fetch` with a one-call dispatcher. It does not go through the patched global fetch, so neither environment proxies nor the MITM DNS bypass can redirect it. A connection that has a connection proxy or relay configured is refused before any call, because a proxy cannot carry a pinned, peer-checked socket.
- Error text never quotes the storage URL, the signed fields, the upstream body or the key.

## Billing and uncertainty

- The init-image and storage phases are not billable. Their failures carry `phase: "init-image"` or `phase: "storage"` and never `acceptedJob`.
- The generation phase is `runLeonardoJob`. These cases carry `acceptedJob` and are never resent: an uncertain submit (timeout, transport error, 5xx, foreign redirect), and an accepted job that was not seen to fail (poll errors, deadline, abort). A Leonardo `FAILED` generation is an ordinary failure.
- Usage is counted once, on success only: one returned image, with unknown cost.

## Tests

`tests/unit/native-leonardo-image-edits.test.js` uses closed mocks only. Leonardo is served by a global fetch mock, storage by an injected `storageFetch`, and DNS by an injected `lookup`. One test drives the real undici transport with a fake socket and makes no network connection. The tests cover:

- real form encoding and parsing
- the selected key on the init-image and generation requests
- an upload without the token
- the exact `init_image_id` and `init_strength`
- the poll and its result
- malformed tickets, statuses and errors
- malicious storage URLs, redirects and DNS answers (private, mixed, rebinding)
- the socket peer guard
- aborts and timeouts in each phase
- an uncertain generation that is not retried
- two concurrent isolated accounts

The block `staging state (isolated)` holds the only unregistered assertion: the public edit entry points do not import this module. Registration replaces that block. All other blocks stay valid after registration.

## Limitations

- Not wired into `/v1/images/edits`. See `registration.json` `integrationPoints`.
- The presigned storage host is not restricted to a vendor domain. Restricting it would mean guessing Leonardo's bucket hosts. Any public https host that passes the checks above is accepted.
- Connections with a configured connection proxy cannot use edits.
- The behavior was not checked against the live service. No live uploads or accounts were used.
