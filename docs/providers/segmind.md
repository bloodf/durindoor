# Segmind video

Segmind (`segmind`) serves native text-to-video generation through Segmind's
model API. It is not a chat provider and does not serve images here.

## Connect

1. Open **Dashboard → Providers → Segmind** and choose **Add Connection**.
2. Paste an API key from your Segmind console and save.

The selected connection's key is sent as the raw `x-api-key` header, and only
to `https://api.segmind.com`. A base URL saved on the connection does not
change that host, redirects are refused, and an answer from another origin is
discarded. Connection proxy settings apply.

## Models

| Model | Name |
| --- | --- |
| `segmind/wan2.1-t2v` | Wan 2.1 Text-to-Video |
| `segmind/hunyuan-video-t2v` | Hunyuan Video Text-to-Video |
| `segmind/ltx-video-t2v` | LTX Video Text-to-Video |
| `segmind/kling-video-t2v` | Kling Video Text-to-Video |

`/v1/models/video` lists these four. Another Segmind text-to-video model can be
used with its Segmind slug, for example `segmind/<slug>`: one path segment of
letters, digits, `.`, `_` or `-`. Image-to-video slugs (such as
`wan2.7-i2v`, or slugs containing `i2v`, `image-to-video` or `img2vid`) are
refused, because no input image is sent.

## Request

`POST /v1/video/generations` with `model` and `prompt` (at most 10,000
characters). Optional:

- `negative_prompt` (string).
- `seed`: an integer from 0 to 4294967295.
- `duration`: seconds, above 0 and at most 60.
- `aspect_ratio` such as `16:9`.
- `n: 1`, `stream: false` and `response_format: "b64_json"` (the default).

Segmind answers with the finished MP4. The response is
`{ created, data: [{ b64_json, format: "mp4" }] }`; the video may be at most
64 MiB.

## What is refused before anything is sent

Streaming, `n` other than 1, `response_format: "url"`, any image, video, audio
or mask input, `size`, `resolution`, `quality`, `fps`, `width`, `height`,
`seconds` (use `duration`), mistyped or out-of-range values, malformed slugs and
a connection without a key. `/v1/videos` job polling is not available for
Segmind; use `/v1/video/generations`.

## Results and usage

Each request is one POST that waits up to 10 minutes for the video, including
the body read. Usage records one video per success with unknown cost. A request
whose outcome is unknown (a server error, a timeout, a cancellation after the
send, an answer from another origin, or a success without a usable MP4) is
recorded once on the selected connection with unknown cost, and is never
retried on another account, model or combo member. Cancelling stops the wait;
Segmind has no job to cancel.

A refused key returns 401. Spent credits return 402 and mark only the selected
connection; a rate limit returns 429 with its reset when Segmind gives one.
Error messages never echo the key, the prompt or Segmind's own error text.
