import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { projectCompletionToClientFormat } from "../translator/response/completionProjector.js";
import { formatSSE } from "./stream.js";

const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

/** Build the canonical completion used by local bypasses and Ponytail commands. */
function createOpenAIResponse(model, text = DEFAULT_BYPASS_TEXT) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  };
}

/** Split a complete OpenAI response into canonical streaming chunks. */
function createOpenAIStreamingChunks(completeResponse) {
  const { id, created, model, choices } = completeResponse;
  const content = choices[0].message.content;

  return [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: null,
      }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: completeResponse.usage,
    },
  ];
}

function normalizeClientFormat(sourceFormat) {
  if (sourceFormat === FORMATS.OPENAI_RESPONSE || sourceFormat === FORMATS.CODEX) {
    return FORMATS.OPENAI_RESPONSES;
  }
  return sourceFormat || FORMATS.OPENAI;
}

function normalizeTranslated(translated) {
  if (translated == null) return [];
  return Array.isArray(translated) ? translated.filter((item) => item != null) : [translated];
}

/**
 * Create a local response in the client's native wire format.
 *
 * JSON responses use the shared whole-completion projector so content is not
 * lost when a streaming translator emits text and termination separately.
 * SSE responses run canonical OpenAI chunks through the registered response
 * translators and use each protocol's native terminal event.
 */
function createSyntheticResponse({ sourceFormat, model, text = DEFAULT_BYPASS_TEXT, stream = false }) {
  const clientFormat = normalizeClientFormat(sourceFormat);
  const completion = createOpenAIResponse(model, text);

  if (!stream) {
    const projected = projectCompletionToClientFormat(completion, clientFormat);
    return {
      success: true,
      response: new Response(JSON.stringify(projected), { headers: JSON_HEADERS }),
    };
  }

  const state = initState(clientFormat);
  state.model = model;
  state.usage = completion.usage;
  const frames = [];

  for (const chunk of createOpenAIStreamingChunks(completion)) {
    const translated = translateResponse(FORMATS.OPENAI, clientFormat, chunk, state);
    for (const item of normalizeTranslated(translated)) {
      const frame = formatSSE(item, clientFormat);
      if (frame) frames.push(frame);
    }
  }

  const flushed = translateResponse(FORMATS.OPENAI, clientFormat, null, state);
  for (const item of normalizeTranslated(flushed)) {
    const frame = formatSSE(item, clientFormat);
    if (frame) frames.push(frame);
  }

  // `[DONE]` is part of Chat Completions only. Responses, Claude, and Gemini
  // terminate with response.completed, message_stop, and finishReason.
  if (clientFormat === FORMATS.OPENAI) frames.push("data: [DONE]\n\n");

  return {
    success: true,
    response: new Response(frames.join(""), { headers: SSE_HEADERS }),
  };
}

// Compatibility wrappers for callers outside this module's shared path.
function createNonStreamingResponse(sourceFormat, model, text) {
  return createSyntheticResponse({ sourceFormat, model, text, stream: false });
}

function createStreamingResponse(sourceFormat, model, text) {
  return createSyntheticResponse({ sourceFormat, model, text, stream: true });
}

export {
  DEFAULT_BYPASS_TEXT,
  createOpenAIResponse,
  createOpenAIStreamingChunks,
  createSyntheticResponse,
  createNonStreamingResponse,
  createStreamingResponse,
};
