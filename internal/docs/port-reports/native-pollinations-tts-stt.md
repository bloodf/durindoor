# Pollinations native audio staging (#2034)

Source: OmniRoute commit c71f0065a7efe9230ec23b96a12253b050c4d7ad,
verified with `git -C /tmp/omni-2034 rev-parse HEAD`.
Attribution: `open-sse/config/audioRegistry.ts` lines 167–174 and 666–673;
`open-sse/handlers/audioSpeech.ts` default OpenAI branch;
`open-sse/handlers/audioTranscription.ts` default multipart branch;
`open-sse/utils/audioMultipart.ts` filename and upload rules (MIT).

## Remaining delta and reachability

The inspected local head was 39919647e5. After fetching origin/main, its
head was a6cb6dea80a4a769dea77208975d24b0d6e40412; the Pollinations
registry and TTS/STT dispatch files match the local head. The existing
`open-sse/providers/registry/pollinations.js` has canonical ID pollinations,
alias pol, API-key auth with keyless chat support, and only the chat endpoint
https://gen.pollinations.ai/v1/chat/completions. Neither ttsConfig nor
sttConfig nor audio model metadata exists. TTS_ADAPTERS has neither ID;
lookupMediaAdapter performs exact lookup without alias normalization.
sttCore requires sttConfig before its generic OpenAI dispatch. The generic
OpenAI envelope therefore does not constitute reachable audio equivalence.
The g4f proxy is a different wire origin and is not equivalent.

The source audio entries are active, static registry rows with
authType apikey, authHeader bearer and format openai. Speech uses
https://gen.pollinations.ai/v1/audio/speech and model default; transcription
uses https://gen.pollinations.ai/v1/audio/transcriptions and model whisper.
The inventory's STT row naming the speech endpoint is a duplicated speech
row, not a third source contract. There is no audio discovery call in these
source paths. Chat model discovery is not evidence for audio models.

## Staged subset

The private index exports adapter instances, factories, request builders,
container/filename helpers, accepted-job accounting and model/config metadata.
registration.json describes exact exports, aliases, models, wire contracts
and future public-handler integration. No production imports, shared registry
changes or connection migrations are made. Both public prefixes must eventually
resolve to the same canonical identity. Serial registration follows the four
additions and must preserve existing chat auth modes and keyless behavior.

TTS follows the source JSON envelope: model, input, voice (default alloy),
response_format (default mp3; ogg maps to opus), speed (default 1), and optional
instructions. A model/voice suffix is supported. Only default is accepted.
The bounded binary result becomes the existing base64/format TTS result;
mp3, opus/Ogg, aac, flac and wav require matching leading signatures.
The json option means the gateway wrapper, never upstream JSON audio.

STT uploads a bounded file via FormData with model whisper and optional
language, prompt, response_format, temperature and timestamp_granularities[].
Native FormData owns the multipart boundary. The source filename rules
(rename opus to ogg, scrub quotes/CR/LF, fallback audio.wav) are preserved
with additional control-character and length bounds. Supported output is
json, text or verbose_json. JSON requires string text; timestamps require
verbose_json. Every requested supported granularity is sent, whereas the
source's get() forwards only the first.

Streaming, translations, URL inputs, unknown models, pcm, srt/vtt/diarized
outputs, invalid speed/temperature and conflicting voices/formats fail before
submission. No browser, WebSocket, job polling or result-URL fetching applies.
TTS JSON artifact URLs and non-audio/HTML bodies are rejected without fetching
them; STT accepts only uploaded bytes, so arbitrary result origins never
receive credentials. Leading signatures check the container, not full decoding.

## Transport and accounting

The selected connection supplies its own Bearer key and egress policy on each
call; no shared credential/token cache exists. Audio requires a real key:
public, sk_durindoor and the noauth connection are refused locally. Source
model labels saying Free are not an anonymous audio auth guarantee. Existing
chat noAuth and authModes are retained in staged metadata.

Only the fixed gen.pollinations.ai origin is contacted, with redirect manual
and every redirect refused. There are zero retries or account fallbacks inside
these adapters. Caller abort and whole-call deadlines bound network and body
reads (120 seconds TTS, 300 seconds STT); STT upload preparation shares the total
budget and late preparation never submits. Abort is forwarded to transport and
body readers; an ignoring transport is detached and its late body cancelled.
Upload buffers cannot themselves be forcibly cancelled by the Blob API.

Limits: 256 KiB serialized TTS input, 25 MiB STT file, 50 MiB audio output,
8 MiB transcript, and bounded refusal/error reads. Upstream errors and
exception bodies are never exposed. 402 sets connection-local quotaExhausted;
401/403 are auth failures, 429/503 preserve usable Retry-After evidence.
Uncertain post-submit failures and lost successful results carry acceptedJob
with unknown cost, preventing honest accounting from treating them as free.
Provably unsent failures have no acceptedJob. Successful usage/duration is
retained when supplied; TTS input characters are added by existing core usage
handling. No price is invented. Registration must record accepted jobs on the
selected connection and stop route-level fallback, including the missing STT
public-route recording path described in registration.json.

## Evidence

Closed synthetic transports only; no live accounts or provider calls.
The focused file covers protocol/body/header fidelity, static metadata,
both keys, malformed/unsafe output, usage, quota, abort before and after send,
body and submit deadlines, upload preparation, and no replay.
Registration assertions are isolated in the staging describe block.
Run from tests:
`node node_modules/vitest/vitest.mjs run unit/native-pollinations-tts-stt.test.js --maxWorkers=2`.
Full CI is intentionally deferred to integration.

Focused result: 78 tests passed. Scoped ESLint and git diff --check passed.

## Original-suite restoration

`tests/unit/pollinations-audio-original-contract.test.js` restores the 72-case
suite from 0c3ed6702c (`git show 0c3ed6702c:tests/unit/native-pollinations-tts-stt.test.js`)
and runs it on the current exports beside the rewritten 78-case suite, which
stays byte-identical. On first run 66 of 72 cases passed. Four failures were
runtime regressions and are fixed in the staged code:

- A voice with CR/LF or other control characters, from `voice` or a model/voice
  suffix, was sent upstream. It is refused locally with a 400 again.
- aac rejected M4A (`ftyp` box at offset 4) audio. The aac signature accepts
  M4A again, alongside ADTS and ADIF.
- `matchesContainer` swapped its arguments from `(bytes, container)` to
  `(container, bytes)`. Either order is accepted now, and the name is unchanged.
- Accepted-job records had lost `meta.authScope: "apikey"`. It is restored.

There are two source-supported intentional differences. Each is marked in the file:

- The `default/nova` refusal row is removed. OmniRoute takes the voice only from
  `body.voice` (audioSpeech.ts default branch), but this fork's TTS adapters
  read `model` as `modelId/voiceId` (`open-sse/handlers/ttsProviders/_base.js`
  parseModelVoice). The rewritten suite pins this behavior. A replacement case
  checks the underlying regression: the suffixed string is never sent as the
  model, and a control-character suffix, an unknown model prefix, and an
  empty suffix are each refused before submit.
- STT success accounting no longer has `meta.authScope`. The frozen suite pins
  that meta to exactly `{ model, responseFormat }`. Nothing outside this
  directory reads `authScope`. Accepted-job records still carry it.

All other original cases run unchanged. These include credential redaction,
format defaults, OGG/JSON normalization, bounded M4A/MP3 input and output,
body deadlines with cancellation and accepted billing, multipart filenames,
fallback and refusal, two selected accounts, and no replay. One independent
case is added: a stalled STT 200 body returns 504 with an accepted job, cancels
the body, and sends exactly one request.
Focused result: 73 + 78 = 151 tests passed.
