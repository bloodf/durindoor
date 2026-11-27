# Runway ML video

Runway ML (`runwayml`, public alias `runway`) serves image generation and
native video generation through the Runway developer API. It is not a chat
provider.

## Connect

1. Open **Dashboard → Providers → Runway ML** and choose **Add Connection**.
2. Paste an API key from https://dev.runwayml.com and save.

The existing Runway connection serves both images and video. The selected
connection's key is sent as `Authorization: Bearer <key>` with
`X-Runway-Version: 2024-11-06`, and only to `https://api.dev.runwayml.com`.
Redirects are refused.

## Video models

| Model | Input |
| --- | --- |
| `runway/gen4.5` | Text, or text and one image |
| `runway/gen4_turbo` | Text and one image (required) |
| `runway/gen3a_turbo` | Text, or text and one image |
| `runway/veo3.1` | Text, or text and one image |
| `runway/veo3.1_fast` | Text, or text and one image |

`/v1/models/video` lists these under `runway`; `/v1/models/image` keeps
listing `runway/gen4_image` and `runway/gen4_image_turbo`. `runwayml/<model>`
works too.

## Request

`POST /v1/video/generations` with `model` and `prompt` (at most 10,000
characters). Optional:

- One image as a public `https` URL in `image`, `image_url`, `imageUrl`,
  `promptImage` or `prompt_image`. With an image the request goes to Runway's
  image-to-video task, otherwise to text-to-video.
- `aspect_ratio` (or `aspectRatio`): `16:9`, `9:16`, `1280:720` or `720:1280`.
  Instead, `size` such as `1280x720` picks landscape or portrait. The default
  is landscape.
- `duration` in seconds as a number (default 5, rounded and kept within 2–10),
  or `frames` with `fps`.
- `seed` as a number.
- `n: 1`, `stream: false` and `response_format: "url"`.

The response is `{ created, data: [{ url, format: "mp4" }] }`.

## What is refused before anything is sent

Streaming, `n` other than 1, `response_format` other than `url`, more than one
image, image arrays or objects, data URIs, private or non-`https` image
addresses, `duration` sent as a string, video or audio inputs,
`provider_options` and any other field. `gen4_turbo` without an image is
refused. `/v1/videos` job polling is not available for Runway; use
`/v1/video/generations`.

## Jobs, results and usage

The gateway submits one task, then polls it every 5 seconds for up to 5
minutes. Each request to Runway has a 30 second limit. Result URLs must be
public `https` URLs and are returned without being downloaded.

Usage records the returned videos with unknown cost. A task that Runway
accepted, or whose submit outcome is unknown, is recorded once on the selected
connection with unknown cost and is never retried on another account, model or
combo member. Cancelling the request stops the wait; it does not cancel the
task at Runway. Refused keys and quota errors apply to the selected connection
only, and error messages never echo the key.
