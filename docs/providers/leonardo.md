# Leonardo.Ai image, video and image edits

Leonardo.Ai (`leonardo`, public alias `leo`) serves native image generation,
reference-image edits and text-to-video through the Leonardo REST API. It is
not a chat provider.

## Connect

1. Open **Dashboard → Providers → Leonardo.Ai** and choose **Add Connection**.
2. Paste a Leonardo API key and save.

The selected connection's key is sent as `Authorization: Bearer <key>`, and
only to `https://cloud.leonardo.ai`. A base URL saved on the connection does
not change that host, and redirects are refused.

## Models

| Kind | Endpoint | Models |
| --- | --- | --- |
| Image | `POST /v1/images/generations` | `leo/phoenix`, `leo/sdxl`, or a Leonardo platform model UUID |
| Image edit | `POST /v1/images/edits` | same as image |
| Video | `POST /v1/video/generations` | `leo/motion-2.0`, `leo/motion-2.0-fast` |

`/v1/models/image` and `/v1/models/video` list the named models. The
`leonardo/` prefix works too.

## Images

Send `model` and `prompt` (at most 32,000 characters). Optional:

- `size` as `WxH`, or `width` and `height`. Each side must be a whole number
  from 32 to 1536 and a multiple of 8. The default is 1024×1024.
- `n: 1` and `response_format: "url"`.

The response is `{ created, data: [{ url }] }`.

## Image edits

`POST /v1/images/edits` takes exactly one reference image and a prompt:

- multipart: `model`, `prompt`, one `image` file, optional `size`
- JSON: `model`, `prompt`, and `image` as a `data:image/...;base64,` URI (or
  `{ "url": "<data URI>" }`), optional `size`

The image must be PNG, JPEG or WebP by its content and at most 10 MiB. The
gateway asks Leonardo for an upload ticket with your key, uploads the image to
the storage address Leonardo returns without your key, then runs a normal
generation that uses the image as its starting point (strength 0.3). The
response is `{ created, data: [{ url }] }`.

Refused for edits before anything is sent: a `mask`, more than one image, a
remote image URL, a `file_id`, `width` or `height` fields, `n` other than 1,
streaming and `response_format` other than `url`. A connection with an
outbound proxy cannot run edits, because the storage upload is sent directly.

## Video

Send `model` and `prompt` (at most 32,000 characters). Optional `size` as
`WxH` picks the shape: landscape gives 16:9, portrait gives 9:16, and 2:3 or
4:5 portrait sizes keep their shape. A short side of 480 or less selects 480p;
otherwise 720p. Without `size` the job is 1280×720. The response is
`{ created, data: [{ url, format: "mp4" }] }`.

## What is refused before anything is sent

Streaming, `n` other than 1, `response_format` other than `url`, and any field
not listed above (for example `style`, `duration` or image inputs on the
generation routes). `/v1/videos` job polling is not available for Leonardo;
use `/v1/video/generations`.

## Jobs, results and usage

The gateway submits one generation, then polls Leonardo every 5 seconds, at
most 60 times and for at most 5 minutes. Each request to Leonardo has a 30
second limit. Result URLs must be public `https` URLs and are returned without
being downloaded.

Usage records one image or one video per success, with unknown cost; Leonardo
credits are not converted to a price. A generation that Leonardo accepted, or
whose submit outcome is unknown, is recorded once on the selected connection
with unknown cost and is never retried on another account, model or combo
member. The upload ticket and the storage upload are not billable, so a
failure there records nothing. Cancelling the request stops the wait; it does
not cancel the job at Leonardo. Refused keys and quota errors apply to the
selected connection only, and error messages never echo the key or the
storage address.
