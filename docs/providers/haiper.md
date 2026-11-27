# Haiper image and video

Haiper (`haiper`, public alias `hp`) serves native image and video generation
through the Haiper Gen 2 job API. It is not a chat provider.

## Connect

1. Open **Dashboard → Providers → Haiper** and choose **Add Connection**.
2. Paste a Haiper API key and save.

The selected connection's key is sent as the raw `HAIPER_KEY` header, and only
to `https://api.haiper.ai`. A base URL saved on the connection does not change
that host, and redirects are refused.

## Models

| Kind | Endpoint | Model |
| --- | --- | --- |
| Image | `POST /v1/images/generations` | `hp/gen2` |
| Video | `POST /v1/video/generations` | `hp/gen2` |

`/v1/models/image` and `/v1/models/video` list `hp/gen2` under the matching
kind. `haiper/gen2` works too.

## Images

Send `model` and `prompt` (at most 8,000 characters). Optional:

- `aspect_ratio`, or `size` as its alias: `16:9` (default), `9:16`, `1:1`, `4:3`
  or `3:4`. If you send both, they must match.
- `n: 1` and `response_format: "url"`.

The response is `{ created, data: [{ url }] }`.

## Video

Send `model` and `prompt`. Every job is 4 seconds at 16:9. You may send
`duration` or `seconds` as `4` and `aspect_ratio` as `16:9`; any other value is
refused. The response is `{ created, data: [{ url, format: "mp4" }] }`.

## What is refused before anything is sent

Streaming, `n` other than 1, `response_format` other than `url`, image inputs,
negative prompts and any other field. `/v1/videos` job polling is not
available for Haiper; use `/v1/video/generations`.

## Jobs, results and usage

The gateway submits one job, then polls Haiper every 5 seconds for up to 5
minutes. Each request to Haiper has a 30 second limit. The result URL must be
a public `https` URL. It is returned without being downloaded.

Usage records one image or one video per success, with unknown cost. A job
that Haiper accepted, or whose submit outcome is unknown, is recorded once on
the selected connection with unknown cost. It is never retried on another
account, model or combo member. Cancelling the request stops the wait; it does
not cancel the job at Haiper. Refused keys and quota errors apply to the
selected connection only, and error messages never echo the key.
