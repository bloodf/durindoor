# deAPI media

deAPI (`deapi`) serves native image generation, text-to-video, speech,
transcription and text embeddings through deAPI's OpenAI-shaped API. It is a
media-only provider: it has no chat models and no chat endpoint here.

## Connect

1. Open **Dashboard → Providers → deAPI** and choose **Add Connection**.
2. Paste an API key from your deAPI account (it looks like `sk-dp-…`) and save.

The selected connection's key is sent as `Authorization: Bearer <key>`, and
only to `https://oai.deapi.ai`. A base URL saved on the connection does not
change that host, redirects are refused, and the key is never refreshed or
rewritten. Connection proxy settings apply.

## Models

| Kind | Endpoint | Models |
| --- | --- | --- |
| Image | `POST /v1/images/generations` | `deapi/ZImageTurbo_INT8`, `deapi/Flux_2_Klein_4B_BF16`, `deapi/Flux1schnell`, `deapi/ZAnimeDistill_8Step_INT8` |
| Video | `POST /v1/video/generations` | `deapi/Ltx2_5_22B_Dist_INT8`, `deapi/MiniMaxH3_33B_Turbo_INT8`, `deapi/Ltx2_3_22B_Dist_INT8`, `deapi/Ltxv_13B_0_9_8_Distilled_FP8` |
| Speech | `POST /v1/audio/speech` | `deapi/Kokoro`, `deapi/Chatterbox`, `deapi/Qwen3_TTS_12Hz_1_7B_CustomVoice`, `deapi/Qwen3_TTS_12Hz_1_7B_VoiceDesign` |
| Transcription | `POST /v1/audio/transcriptions` | `deapi/WhisperLargeV3Ct2`, `deapi/WhisperLargeV3` |
| Embedding | `POST /v1/embeddings` | `deapi/Bge_M3_FP16` (1024 dimensions) |

`/v1/models/image`, `/v1/models/video`, `/v1/models/tts`, `/v1/models/stt` and
`/v1/models/embedding` list these rows. The list is static; deAPI is not asked
for models. Only these ids are accepted, and a model of one kind is refused on
another kind's route.

## Image

Send `model` and `prompt` (at most 32,000 characters). Optional:

- `size`: `512x512`, `768x768` or `1024x1024` for the two Z-Image models;
  those three plus `1024x1536` and `1536x1024` for the FLUX models.
- `response_format`: `url` or `b64_json`. A requested format must be the one
  deAPI returns; a URL is never downloaded and must be public `https`.
- `quality` and `style`: short lowercase option names, sent as given.
- `n: 1` and `output_format: "png"`.

One request waits up to 2 minutes. Streaming, `n` other than 1, input images,
masks, other output formats and any other field are refused before anything
is sent. Image edits (`/v1/images/edits`) are not available for deAPI.

## Video

Send `model` and `prompt` (at most 32,000 characters). Optional:
`seconds` or `duration` (a whole number from 1 to 600; send one, or both with
the same value), `size` as `WIDTHxHEIGHT` such as `768x768`, `n: 1` and
`response_format: "b64_json"` (the default and only format).

The gateway submits one deAPI video job, checks it every 5 seconds for up to
10 minutes, then reads the finished clip with the same key. The response is
`{ created, data: [{ b64_json, format: "mp4" }] }`; the clip may be at most
64 MiB. Streaming, `response_format: "url"`, input images and any other field
are refused before anything is sent. `/v1/videos` job polling is not
available for deAPI; use `/v1/video/generations`.

## Speech

Send `model` and `input`. The voice defaults to `alloy`; set `voice`, or name
it in the model as `deapi/Kokoro/<voice>` (not both with different values).
Optional: `speed` from 0.25 to 4 (default 1) and `instructions`.
`Qwen3_TTS_12Hz_1_7B_VoiceDesign` requires `instructions` describing the voice.

deAPI returns MP3 only. Omit `response_format`, or use `mp3` for raw audio or
`json` for `{ audio, format }` with base64 audio. Other formats and streaming
are refused before anything is sent. One request waits up to 2 minutes; the
audio may be at most 50 MiB and the request body at most 256 KiB.

## Transcription

Send a multipart form with `model` and `file` (at most 25 MiB). Optional:
`language`, `prompt` (each at most 4,096 characters), `temperature` (0 to 1)
and `response_format`:

- `json` (default), `text` or `verbose_json` for both models.
- `diarized_json` only for `WhisperLargeV3Ct2`.
- `timestamp_granularities[]` (`segment`, `word`) only with `verbose_json`;
  `word` only for `WhisperLargeV3Ct2`.

One request waits up to 5 minutes. Translations
(`/v1/audio/translations`), streaming, `srt`/`vtt`, a `url` instead of a file
and an empty file are refused before anything is sent.

## Embeddings

Send `model` and `input`: one string or 1 to 256 non-empty strings, each at
most 20,000 characters. Optional: `encoding_format` (`float`, or `base64`
packed by the gateway from the returned floats), `dimensions: 1024` and
`user` (accepted, not sent). Token arrays, structured or media inputs, other
dimensions and any other field (such as `input_type`) are refused before
anything is sent. One request waits up to 60 seconds. The response is the
OpenAI list shape, ordered by `index`, with deAPI's token counts when given.

## Results and usage

Usage is recorded once per success on the selected connection, with deAPI's
token counts for embeddings when it returns them and unknown cost otherwise.

A request whose outcome is unknown (a server error, a timeout or cancellation
after the send, a redirect to another host, a video job whose status or clip
cannot be read, or a success without a usable result) is recorded once on the
selected connection with unknown cost. It is never retried on another
account, fallback model or combo member. A video job that deAPI reports as
failed returns 502 and records nothing. Cancelling stops the wait; it does
not cancel work deAPI already started.

A refused key returns 401. Spent credits return 402 and mark only the selected
connection, so another connection can serve the next request; a rate limit
returns 429 with its reset when deAPI gives one. Error messages never echo the
key, the prompt or deAPI's own error text.
