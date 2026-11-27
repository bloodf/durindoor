# Kie.ai speech and transcription

The existing Kie.ai connection (`kie`) also serves ElevenLabs speech and
transcription through Kie's task API. There is no new connection type: add or
edit **Kie.ai** in **Dashboard → Providers**, paste your Kie API key and save.
The same selected connection serves chat, image, video, speech and
transcription.

The key is sent as `Authorization: Bearer <key>`, and only to
`https://api.kie.ai`. A base URL saved on the connection does not change that
host.

## Speech

`POST /v1/audio/speech` with one of:

- `kie/elevenlabs/text-to-speech-multilingual-v2`
- `kie/elevenlabs/text-to-speech-turbo-2-5`

Send `model` and `input`. Optional:

- `voice`: an ElevenLabs voice name. You can also append it to the model, as
  in `kie/elevenlabs/text-to-speech-turbo-2-5/Rachel`; if you name it twice the
  two must match. The OpenAI names map to ElevenLabs voices: `alloy` → Rachel,
  `echo` → Adam, `fable` → Brian, `onyx` → Antoni, `nova` → Bella,
  `shimmer` → Dorothy. The default is Rachel.
- `stability`, `similarity_boost`, `style`, `speed` (numbers)
- `previous_text`, `next_text`, `language_code` (strings)
- `response_format`: omit it, or use `mp3` or `json`. Any other container is
  refused before submit. The `?response_format=json` query parameter returns
  `{ audio: <base64>, format }`; otherwise the response is the audio file.

Refused before submit: streaming, `timestamps`, callback URLs, and the
excluded models `elevenlabs/text-to-dialogue-v3`, `elevenlabs/sound-effect-v2`
and `elevenlabs/audio-isolation`.

The gateway creates one task, polls it every 2 seconds for up to 60 seconds,
then downloads the audio from the result URL without sending your key. The
result must be a public `https` URL and at most 50 MiB.

## Transcription

`POST /v1/audio/transcriptions` (multipart) with `model`
`kie/elevenlabs/speech-to-text` and one `file` of at most 25 MiB.
`response_format` is `json` (default, `{ text }`) or `text`. `language`,
`prompt` and `temperature` are accepted but not sent to Kie.

Refused before submit: `/v1/audio/translations`, streaming, timestamps or
`timestamp_granularities`, `verbose_json`, `srt`, `vtt`, an empty file and
audio isolation. The gateway polls the task every 2 seconds for up to 120
seconds.

## Discovery and usage

`/v1/models/tts` and `/v1/models/stt` list these models under `kie`. The list
is static; it does not call Kie.

Speech usage counts input characters; transcription usage records the request.
Cost is unknown for both. A task Kie accepted, or whose submit outcome is
unknown, is recorded once on the selected connection with unknown cost and is
never retried on another account or combo member. Cancelling the request
stops the wait; it does not cancel the task at Kie. Refused keys and quota
errors apply to the selected connection only, and error messages never echo
the key.
