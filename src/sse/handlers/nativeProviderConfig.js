const exact = (method, path, options = {}) => ({ method, path, ...options });
const parameter = (method, path, options = {}) => ({ method, path, parameter: true, ...options });

export const NATIVE_OPERATIONS = {
  openai: [
    exact("POST", "/v1/responses", { kind: "responses", returnsConnection: true, createsResource: true, resourceResponseField: "id" }),
    parameter("GET", "/v1/responses/{id}", { kind: "responses", accountBound: true, completionPoll: true, resourceParam: "id" }),
    parameter("POST", "/v1/responses/{id}/cancel", { kind: "responses", accountBound: true, resourceParam: "id" }),
    parameter("DELETE", "/v1/responses/{id}", { kind: "responses", accountBound: true, resourceParam: "id" }),
    exact("POST", "/v1/chat/completions", { kind: "chat" }),
    exact("POST", "/v1/realtime/client_secrets", { kind: "realtime" }),
    exact("POST", "/v1/realtime/translations/client_secrets", { kind: "realtime-translation" }),
    exact("POST", "/v1/realtime/transcription_sessions", { kind: "realtime-transcription" }),
    exact("POST", "/v1/live/sessions", { kind: "live" }),
  ],
  minimax: [
    exact("POST", "/anthropic/v1/messages", { kind: "messages", auth: "x-api-key" }),
    exact("POST", "/v1/chat/completions", { kind: "chat" }),
    exact("POST", "/v1/responses", { kind: "responses" }),
    exact("POST", "/v1/text/chatcompletion_v2", { kind: "chat" }),
    exact("POST", "/v1/speech_to_text", { kind: "stt" }),
    exact("POST", "/v1/t2a_v2", { kind: "tts" }),
    exact("POST", "/v1/image_generation", { kind: "image" }),
    exact("POST", "/v1/music_generation", { kind: "music" }),
    exact("POST", "/v1/lyrics_generation", { kind: "music" }),
    exact("POST", "/v1/music_cover_preprocess", { kind: "music" }),
    exact("POST", "/v1/t2a_async_v2", { kind: "tts", returnsConnection: true, createsResource: true, resourceResponseField: "task_id" }),
    exact("GET", "/v1/query/t2a_async_query_v2", { kind: "tts", accountBound: true, completionPoll: true, resourceQuery: "task_id" }),
    exact("POST", "/v1/voice_design", { kind: "tts", returnsConnection: true, createsResource: true, resourceResponseField: "voice_id" }),
    exact("POST", "/v1/voice_clone", { kind: "tts", returnsConnection: true }),
    exact("POST", "/v1/get_voice", { kind: "tts", accountBound: true }),
    exact("POST", "/v1/delete_voice", { kind: "tts", accountBound: true, resourceBodyField: "voice_id" }),
    exact("POST", "/v1/files/upload", { kind: "file", returnsConnection: true, createsResource: true, resourceResponsePath: ["file", "file_id"] }),
    exact("POST", "/v2/video_generation", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "task_id" }),
    exact("POST", "/v2/h3_context_ir", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "task_id" }),
    exact("POST", "/v2/video_regeneration", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "task_id" }),
    exact("POST", "/v1/video_generation", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "task_id" }),
    exact("GET", "/v2/query/video_generation", { kind: "video", accountBound: true, completionPoll: true, resourceQuery: "task_id" }),
    parameter("GET", "/v2/query/video_generation/{task_id}", { kind: "video", accountBound: true, completionPoll: true, resourceParam: "task_id" }),
    parameter("DELETE", "/v2/video_generation/{task_id}", { kind: "video", accountBound: true, resourceParam: "task_id" }),
    exact("GET", "/v1/query/video_generation", { kind: "video", accountBound: true, completionPoll: true, resourceQuery: "task_id" }),
    exact("GET", "/v1/files/retrieve", { kind: "file", accountBound: true, resourceQuery: "file_id" }),
    exact("GET", "/v1/files/retrieve_content", { kind: "file", accountBound: true, resourceQuery: "file_id" }),
  ],
  anthropic: [
    exact("POST", "/v1/messages", { kind: "messages" }),
    exact("POST", "/v1/messages/batches", { kind: "batches", returnsConnection: true, createsResource: true, resourceResponseField: "id" }),
    exact("GET", "/v1/messages/batches", { kind: "batches", accountBound: true, listsResources: true }),
    parameter("GET", "/v1/messages/batches/{id}", { kind: "batches", accountBound: true, resourceParam: "id" }),
    parameter("GET", "/v1/messages/batches/{id}/results", { kind: "batches", accountBound: true, resourceParam: "id" }),
    parameter("POST", "/v1/messages/batches/{id}/cancel", { kind: "batches", accountBound: true, resourceParam: "id" }),
    parameter("DELETE", "/v1/messages/batches/{id}", { kind: "batches", accountBound: true, resourceParam: "id" }),
    exact("POST", "/v1/files", { kind: "file", returnsConnection: true, createsResource: true, resourceResponseField: "id" }),
    exact("GET", "/v1/files", { kind: "file", accountBound: true, listsResources: true }),
    parameter("GET", "/v1/files/{id}", { kind: "file", accountBound: true, resourceParam: "id" }),
    parameter("GET", "/v1/files/{id}/content", { kind: "file", accountBound: true, resourceParam: "id" }),
    parameter("DELETE", "/v1/files/{id}", { kind: "file", accountBound: true, resourceParam: "id" }),
  ],
  xai: [
    exact("POST", "/v1/responses", { kind: "responses" }),
    exact("POST", "/v1/images/generations", { kind: "image" }),
    exact("POST", "/v1/images/edits", { kind: "image" }),
    exact("POST", "/v1/videos/generations", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "request_id" }),
    exact("POST", "/v1/videos/edits", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "request_id" }),
    exact("POST", "/v1/videos/extensions", { kind: "video", returnsConnection: true, createsResource: true, resourceResponseField: "request_id" }),
    parameter("GET", "/v1/videos/{id}", { kind: "video", accountBound: true, completionPoll: true, resourceParam: "id" }),
    exact("POST", "/v1/tts", { kind: "tts" }),
    exact("POST", "/v1/stt", { kind: "stt" }),
  ],
  cohere: [
    exact("POST", "/v2/parse", { kind: "documentParsing" }),
    exact("POST", "/v2/embed", { kind: "embedding" }),
    exact("POST", "/v2/rerank", { kind: "rerank" }),
    exact("POST", "/v2/audio/transcriptions", { kind: "stt" }),
  ],
};
NATIVE_OPERATIONS["minimax-cn"] = NATIVE_OPERATIONS.minimax;

// Native streaming transports without an OpenAI-compatible event dialect.
export const NATIVE_WEBSOCKETS = {
  minimax: {
    "/ws/v1/t2a_v2": { kind: "tts", wsUrl: "wss://api.minimax.io/ws/v1/t2a_v2" },
    "/ws/v1/t2a_v2_bidi": { kind: "tts", wsUrl: "wss://api.minimax.io/ws/v1/t2a_v2_bidi" }
  },
  "minimax-cn": {
    "/ws/v1/t2a_v2": { kind: "tts", wsUrl: "wss://api.minimax.cn/ws/v1/t2a_v2" },
    "/ws/v1/t2a_v2_bidi": { kind: "tts", wsUrl: "wss://api.minimax.cn/ws/v1/t2a_v2_bidi" }
  },
  xai: {
    "/v1/stt": {
      kind: "stt", wsUrl: "wss://api.x.ai/v1/stt", modelInQuery: true, omitModelIds: ["stt"], binaryAudio: true,
      queryParameters: ["sample_rate", "encoding", "interim_results", "endpointing", "language", "diarize", "filler_words", "multichannel", "channels", "keyterm", "smart_turn", "smart_turn_timeout", "vad_threshold"]
    }
  },
  gemini: {
    "/live": {
      kind: "live", wsUrl: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
      queryAuth: "key", geminiLive: true
    }
  }
};

const ORIGINS = {
  openai: "https://api.openai.com",
  minimax: "https://api.minimax.io",
  "minimax-cn": "https://api.minimax.cn",
  anthropic: "https://api.anthropic.com",
  xai: "https://api.x.ai",
  cohere: "https://api.cohere.com",
};

export function nativeOrigin(provider) {
  return ORIGINS[provider] || null;
}

export function findNativeOperation(provider, method, path) {
  return (NATIVE_OPERATIONS[provider] || []).find((operation) => {
    if (operation.method !== method) return false;
    if (!operation.parameter) return operation.path === path;
    const expression = `^${operation.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}/g, "[A-Za-z0-9_-]+")}$`;
    return new RegExp(expression).test(path);
  }) || null;
}
