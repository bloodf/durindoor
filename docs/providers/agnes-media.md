# Agnes native image and video

The existing Agnes API-key connection (`agnes`) serves chat, native image
generation and native video generation. There is no new sign-in or connection
type. Add an Agnes API key once in the dashboard and the same selected
connection is used for every kind. `agnes-cn` stays chat-only, because Agnes
publishes no China media endpoint for it.

The key only ever goes to `https://apihub.agnes-ai.com` as
`Authorization: Bearer <key>`. A base URL saved on the connection does not
redirect it, and redirects from Agnes are refused.

## Images

Use `POST /v1/images/generations`. The dashboard catalog and
`/v1/models/image` list three models:

- `agnes/agnes-image-2.0-flash`
- `agnes/agnes-image-2.1-flash`
- `agnes/agnes-image-2.5-flash`

`size` is required and must be `1K`, `2K`, `3K` or `4K`. Optional fields:

- `ratio` (or `aspect_ratio`) in `W:H` form, for example `16:9`
- `response_format` of `url` or `b64_json`. When you name one, an answer in
  the other form fails instead of being converted. With no format named, the
  image comes back as Agnes sent it.
- up to 16 input images through `image_url`, `image`, `image_urls` or
  `imageUrls`. Each must be a public `https` URL or a `data:image/...;base64`
  URI. Agnes fetches URL inputs; the gateway does not.
- `extra_body`, an object that is passed through to Agnes

The response is `{ created, data: [{ url } | { b64_json }] }`. Returned URLs
must be public `https` URLs; anything else is dropped.

Refused before anything is sent: `n` other than 1, streaming,
`response_format=binary`, `mask`, `quality`, `style`, `output_format`,
`output_compression`, `background`, `moderation`, prompts over 32,000
characters, and private or non-https input URLs. `/v1/images/edits` is not
available for Agnes.

## Video

Use `POST /v1/video/generations`. The dashboard catalog and
`/v1/models/video` list three models:

- `agnes/agnes-video-v2.0`
- `agnes/agnes-video-2.5-flash`
- `agnes/agnes-video-2.5`

Send `model` and `prompt`. Other fields are forwarded to Agnes as they are,
for example `seconds` for the 2.5 models (a number is sent as a string) or
`num_frames` and `frame_rate` for V2.0. `duration` is refused, because Agnes
ignores it; use `seconds` instead. Only `response_format: "url"` is
supported, and `n` other than 1, streaming and bodies over 20 MiB are refused.

The gateway submits the job once, then polls Agnes every 2 seconds, at most 60
times and for at most 5 minutes. The response is
`{ created, data: [{ url, format: "mp4" }] }`. The video URL is returned
without being downloaded. `/v1/videos` is not available for Agnes, because the
gateway does not hand native job IDs to clients.

## Errors, retries and usage

- 401 and 403 answers are passed through and mark only the selected
  connection.
- 402 answers, and 403 or 429 answers whose code mentions quota, balance,
  credit or arrears, become 402 for the selected connection.
- 429 answers are rate limits and honor `Retry-After`.
- Error messages carry the status and a short vendor code only, never the
  upstream text or your key.

Once Agnes may have accepted a request, it is never sent again on another
connection. This covers a 5xx answer, a lost connection, a deadline, a caller
cancel after sending, an unreadable status or a finished job without a usable
URL. The request is recorded once with unknown cost. Successful usage counts
returned images or videos; cost stays unknown, and requested duration is not
counted as billed usage.

Model lists are static. Agnes has no media discovery endpoint, and the live
chat model list stays chat-only.

Port source: cheaper-inference/OmniRoute (MIT), commit
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`,
`open-sse/config/imageRegistryData.ts`, `open-sse/config/videoRegistry.ts`,
`open-sse/handlers/imageGeneration.ts` and
`open-sse/handlers/videoGeneration/job.ts`. Verification uses closed mocks with
synthetic keys; no live Agnes calls are made.
