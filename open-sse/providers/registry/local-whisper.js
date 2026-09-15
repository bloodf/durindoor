/**
 * Self-hosted Whisper speech-to-text server.
 *
 * Targets any OpenAI-compatible transcription server the user runs themselves
 * (faster-whisper-server, speaches, an OpenVINO/FastAPI wrapper, …): the
 * contract is a multipart `POST {baseUrl}/v1/audio/transcriptions` returning
 * `{ "text": "…" }`, which is exactly the `openai` STT format.
 *
 * Two deviations from a cloud STT provider:
 *
 *  - **No auth.** A local server has no key, so `authType: "none"` — the STT
 *    core then skips the credential requirement entirely.
 *  - **User-supplied host.** The port and interface are the user's choice, so
 *    the base URL lives per connection in `providerSpecificData.baseUrl` and is
 *    resolved at request time by `resolveLocalWhisperHost`, mirroring
 *    ollama-local. The `sttConfig.baseUrl` below is the default only.
 *
 * The model label is passed through to the server but most self-hosted builds
 * transcribe with whatever model they were started with and ignore the field,
 * so a single passthrough entry is exposed rather than a fabricated catalog.
 */
export default {
  id: "local-whisper",
  priority: 50,
  hasFree: true,
  alias: "local-whisper",
  display: {
    name: "Local Whisper",
    icon: "mic",
    color: "#7c93ff",
    textIcon: "LW",
    website: "https://github.com/openai/whisper",
  },
  category: "apikey",
  noAuth: true,
  // No `transport`: this provider serves STT only. A transport block would
  // register a generic chat URL and let /v1/chat/completions target a
  // transcription server that cannot answer it. The STT route resolves its
  // endpoint from `sttConfig`, and models register without transport
  // (providers/index.js builds PROVIDER_MODELS from `models` directly).
  models: [
    {
      id: "whisper-1",
      name: "Local Whisper",
      params: ["language", "response_format", "temperature", "prompt"],
      kind: "stt",
    },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "http://127.0.0.1:11500/v1/audio/transcriptions",
    authType: "none",
    format: "openai",
    // Host is per connection; sttCore resolves it via resolveLocalWhisperHost.
    userConfigurableHost: true,
  },
  passthroughModels: true,
};
