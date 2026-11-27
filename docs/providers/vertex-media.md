# Vertex AI native video, speech, transcription and music

The existing Vertex AI connection (`vertex`, public alias `vx`) serves chat and
four native media kinds:

| Kind | Endpoint | Models |
| --- | --- | --- |
| Video (Veo) | `POST /v1/video/generations` | `vx/veo-3.1-generate-001`, `vx/veo-3.1-fast-generate-001` |
| Speech (Gemini TTS) | `POST /v1/audio/speech` | `vx/gemini-3.1-flash-tts-preview`, `vx/gemini-2.5-flash-preview-tts`, `vx/gemini-2.5-pro-preview-tts`, `vx/gemini-3.8-flash-tts`, `vx/gemini-3.8-flash-lite-tts` |
| Transcription (Gemini) | `POST /v1/audio/transcriptions` | `vx/gemini-2.5-flash`, `vx/gemini-2.5-pro`, `vx/gemini-2.0-flash` |
| Music (Lyria 2) | `POST /v1/music/generations` | `vx/lyria-002` |

The lists are static, and `/v1/models/{kind}` shows them. `vx/gemini-2.5-flash`
is also a chat model, so the typed transcription listing omits it, but
transcription requests accept it. Vertex Partner (`vertex-partner`) gets none
of these kinds.

## Connection

There is no new sign-in or connection type. Use the Vertex AI connection you
already have, with one of these credentials:

- **Service Account JSON key.** DurinDoor mints a short-lived token for each
  request. The project is the key's `project_id`.
- **ADC `authorized_user` file.** DurinDoor refreshes it for each request. The
  project is the file's `quota_project_id`, or the project ID saved on the
  connection.
- **Access token.** The token is sent as is. Save the project ID on the
  connection.
- **Vertex AI Express API key.** The key is sent as `?key=` to the
  project-less `https://aiplatform.googleapis.com` publisher endpoint.

With a Bearer credential (the first three), requests go to your project at the
location saved on the connection, `us-central1` by default. Speech,
transcription and music also accept `global`, `us` and `eu`. Video needs a
regional location such as `us-central1`. A Bearer connection without a usable
project is refused before anything is sent. Redirects are refused.

Enable the Vertex AI API on the project and grant the service account a role
that can call Vertex AI predictions, such as Vertex AI User.

## Video

Send `model` and `prompt`. Optional fields:

- `duration` (or `durationSeconds`): 4, 6 or 8
- `aspect_ratio` (or `aspectRatio`, or a matching `size`): `16:9` or `9:16`
- `negative_prompt`

Only `response_format: "b64_json"` is supported. The response is
`{ created, data: [{ b64_json, format: "mp4" }] }`. The gateway submits one
long-running operation, then polls it every 10 seconds for at most 5 minutes.

Refused before anything is sent: image, video, audio or other media inputs,
`n` other than 1, streaming, `response_format: "url"`, other durations and
aspect ratios. `/v1/videos` is not available for Vertex.

Google documents 4, 6 or 8 second clips for Veo 3.1 and Veo 3.1 Fast
([Veo 3.1 model page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate?hl=en),
[text-to-video reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text),
checked 2026-11-27). Veo 3.0, Veo 3.0 Fast and Veo 2.0 are not listed, because
Google's
[model versions page](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
lists them as retired on 2026-06-30 (checked 2026-11-27).

## Speech

Send `model`, `input` and optionally `voice`, a Gemini prebuilt voice such as
`Kore` (the default) or `Puck`. A voice can also follow the model, as in
`vx/gemini-2.5-flash-preview-tts/Puck`. `instructions` and `speed` (0.25 to 4)
become a speaking-style note. The dashboard voice picker
(`/api/media-providers/tts/voices?provider=vertex`) lists the same prebuilt
voices as Gemini; `GET /v1/audio/voices` does not cover Vertex.

The output is WAV by default. Name `response_format` `wav`, `pcm` or `json`;
`json` returns `{ audio, format }` with base64 audio. Pass `json` as the
`?response_format=json` query parameter. MP3 and other formats are refused, as
are streaming, a `language` field (Gemini reads it from the input) and inputs
over 32,000 characters.

## Transcription

Send a multipart form with one audio `file`, `model`, and optionally
`language` or `prompt` (not both) and `response_format` of `json` (default) or
`text`. The response is `{ text }` or plain text. Accepted audio is WAV, MP3,
AIFF, AAC, OGG, FLAC, WebM, MP4/M4A or PCM, up to 14 MiB. Other fields and
`/v1/audio/translations` are refused before anything is sent.

## Music

Send `model` and `prompt`, and optionally `negative_prompt`, and either `seed`
or `sample_count` (1 to 4), not both. Music is instrumental WAV only:
`response_format` other than `b64_json`, `output_format` other than `wav`,
`lyrics`, `duration` and non-instrumental flags are refused before anything is
sent. The single predict call is synchronous, with a 3-minute limit. The
response is
`{ object: "music.generation", provider: "vertex", model, status: "completed", data: [{ b64_json, format: "wav", mime_type: "audio/wav", duration_seconds }] }`.

## Errors, retries and usage

- 401, 403 and 429 answers mark only the selected connection. 429 honors
  `Retry-After`. A project without active billing returns 402.
- Error messages carry the status and Google's status code only, never the
  upstream text, your key or token.
- Once Google may have run a request, it is never sent again on another
  connection. This covers a 5xx answer, a lost connection, a deadline, a caller
  cancel after sending, or a finished call without usable audio, transcript or
  video. It is recorded once with unknown cost.
- Successful speech and transcription usage records the token counts Google
  reports. Video counts one returned video, and music records the returned
  audio seconds. No Vertex media price is applied, so cost stays unknown.

Port source: cheaper-inference/OmniRoute (MIT), commit
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`,
`open-sse/config/videoRegistry.ts`, `open-sse/config/audioRegistry.ts`,
`open-sse/config/musicRegistry.ts` and `open-sse/executors/vertexMedia.ts`.
Verification uses closed mocks with synthetic credentials; no live Google
calls are made.
