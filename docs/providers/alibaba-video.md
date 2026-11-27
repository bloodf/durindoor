# Alibaba native video

The existing Alibaba API-key connection (`alibaba`, public alias `ali`) serves
chat and native video. Use `POST /v1/video/generations` with
`model: "ali/wan2.7-t2v-2026-06-12"`, a `prompt`, and optionally `duration`,
`resolution: "720P"` or `"1080P"`, and `ratio: "16:9"`. Only
`response_format: "url"` is supported. The response is
`{ created, data: [{ url, format: "mp4" }] }` after bounded polling.
`/v1/videos` is explicitly unsupported; the gateway does not expose native task
IDs for client polling. Existing chat transport and live chat discovery remain.

The dashboard catalog and `/v1/models/video` list these nine models:

- `happyhorse-1.1-i2v`, `happyhorse-1.1-t2v`, `happyhorse-1.1-r2v`
- `happyhorse-1.0-video-edit`
- `wan2.7-i2v-2026-04-25`, `wan2.6-i2v-flash`
- `wan2.7-t2v-2026-06-12`, `wan2.7-r2v-2026-06-12`, `wan2.7-videoedit`

Image-to-video requires one first frame (`image_url`); it accepts resolution,
but no ratio or size. Reference-to-video requires reference images, with
reference videos also supported by Wan. Video editing requires one `video_url`
and permits reference images. Wan text-to-video optionally accepts `audio_url`;
Wan image-to-video permits last-frame and driving-audio media. Explicit `media`
lists cannot be mixed with shorthand fields. Media must use public HTTPS URLs.

Common options are `negative_prompt`, `duration` (or `seconds`), `resolution`,
`prompt_extend`, `watermark`, `seed`, and `shot_type`. Non-image-to-video models
also accept `ratio`/`aspect_ratio` or a matching `size`. Supported ratios are
16:9, 9:16, 1:1, 4:3 and 3:4. Unsupported models, media combinations and options
are refused before submission. Raw `parameters`, multiple outputs and base64
responses are unsupported. Undated Wan aliases are not added.

The selected saved key goes as native Bearer authorization only to the fixed
international DashScope origin; connection base URLs cannot redirect it. There
is no new sign-in or provider identity, and `alibaba-cn` is not activated by this
registration. Native authentication failures and quota lockout affect the
selected connection. Accepted or uncertain jobs are recorded once with unknown
cost and are never submitted again on another account. Successful usage counts
the returned video; requested duration is not treated as billed usage.

Port source: cheaper-inference/OmniRoute (MIT), commit
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`,
`open-sse/config/videoRegistry.ts` and
`open-sse/handlers/videoGeneration/dashscopeHandler.ts`. The adapter's existing
validation, polling bounds and accepted-job behavior are preserved. Verification
uses closed mocks with synthetic keys; no live account calls are made.
