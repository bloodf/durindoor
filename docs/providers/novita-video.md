# Novita AI video

The existing Novita AI provider (`novita`) also serves native text-to-video
through Novita's async task API. Chat keeps its OpenAI-compatible transport,
connection test and model list.

## Connect

Use the same Novita AI connection as chat: open **Dashboard → Providers →
Novita AI**, choose **Add Connection**, paste an API key from
https://novita.ai/settings/key-management and save. No separate setup is
needed for video.

The selected connection's key is sent as `Authorization: Bearer <key>`, and
only to `https://api.novita.ai`. A base URL saved on the connection does not
change that host for video, and redirects are refused. Connection proxy
settings apply.

## Models

| Model | Name |
| --- | --- |
| `novita/wan-t2v` | Wan 2.1 Text-to-Video |
| `novita/kling-v1.6-t2v` | Kling V1.6 Text-to-Video |

`/v1/models/video` lists these two. The chat model list is unchanged and never
adds video rows; other video model ids are refused.

## Request

`POST /v1/video/generations` with `model` and `prompt` (at most 8,000
characters). Optional:

- `negative_prompt` (a string of at most 8,000 characters).
- `duration` or `seconds`: a whole number from 1 to 60 (send one, or both with
  the same value).
- `size` as `WIDTHxHEIGHT`, each side from 64 to 4096.
- `timeout_ms` (up to 600,000; default 300,000) and `poll_interval_ms`
  (1,000 to 120,000; default 2,500) for the gateway's own wait. They are not
  sent to Novita.
- `n: 1` and `response_format: "url"` (the default and only format).

The gateway submits one task, polls Novita's task result until it finishes or
the wait ends, and answers `{ created, data: [{ url, format: "mp4" }] }`. The
result URL must be public `https` and is returned without being downloaded.

## What is refused before anything is sent

Streaming, `n` other than 1, `response_format` other than `url`, input images
or other media, out-of-range or mistyped values and any other field.
`/v1/videos` job polling is not available for Novita; use
`/v1/video/generations`.

## Results and usage

Usage records one video per success with unknown cost. A task whose outcome
is unknown (a server error, a timeout or cancellation after the submit, a task
that ends with Novita's unknown-error state, or a success without a usable
URL) is recorded once on the selected connection with unknown cost, and is
never retried on another account, fallback model or combo member. A task that
Novita reports as failed returns 502 and records nothing. Cancelling stops the
wait; it does not cancel the task at Novita.

A refused key returns 401. Spent credits return 402 and mark only the selected
connection; a rate limit returns 429 with its reset when Novita gives one.
Error messages never echo the key, the prompt or Novita's own error text.
