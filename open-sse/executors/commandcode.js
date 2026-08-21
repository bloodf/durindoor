import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { ERROR_TYPES } from "../config/errorConfig.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import {
  COMMANDCODE_OVERLOAD_PATTERNS,
  COMMANDCODE_PREFLIGHT_MAX_BYTES,
  COMMANDCODE_PREFLIGHT_MAX_FRAMES,
  COMMANDCODE_RATE_LIMIT_PATTERNS,
} from "../config/commandcode.js";
import { COMMANDCODE_EVENT } from "../translator/schema/index.js";
import { cancelAndReleaseReader, releaseReader } from "../utils/streamReader.js";

const COMMANDCODE_PREFLIGHT_PREAMBLE_EVENTS = new Set([
  COMMANDCODE_EVENT.START,
  COMMANDCODE_EVENT.START_STEP,
  COMMANDCODE_EVENT.REASONING_START,
  COMMANDCODE_EVENT.REASONING_END,
  COMMANDCODE_EVENT.TEXT_START,
  COMMANDCODE_EVENT.TEXT_END,
  COMMANDCODE_EVENT.TOOL_INPUT_END,
  COMMANDCODE_EVENT.PROVIDER_METADATA,
  COMMANDCODE_EVENT.MESSAGE_METADATA,
]);

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor(provider = "commandcode") {
    super(provider, PROVIDERS[provider] || PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    if (!body.params) body.params = {};
  
    body.stream = true;
    body.params.stream = true;
  
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    result.response = await inspectAndWrapCommandCodeResponse(result.response, opts.model);
    if (result.response.ok) result.terminalProvenance = "validated";
    return result;
  }

  /** Normalize PR #3405 preflight failures for the shared fallback parser. */
  parseError(response, bodyText) {
    try {
      const parsed = JSON.parse(bodyText || "{}");
      return {
        status: response.status,
        message: parsed?.error?.message || parsed?.message || bodyText || response.statusText,
        errorBody: parsed,
      };
    } catch {
      return super.parseError(response, bodyText);
    }
  }
}

export {
  COMMANDCODE_PREFLIGHT_MAX_BYTES,
  COMMANDCODE_PREFLIGHT_MAX_FRAMES,
};

function explicitErrorStatus(event) {
  const error = event?.error;
  for (const value of [event?.statusCode, event?.status, error?.statusCode, error?.status, error?.code]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return null;
}

function errorMessage(event) {
  const value = event?.error ?? event?.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    return JSON.stringify(value);
  }
  return "CommandCode upstream error";
}

function errorType(statusCode) {
  return ERROR_TYPES[statusCode]?.type
    || (statusCode >= HTTP_STATUS.SERVER_ERROR ? "server_error" : "invalid_request_error");
}

/** Normalize an embedded CommandCode error event for HTTP fallback (upstream PR #3405). */
export function parseCommandCodeError(event) {
  const message = errorMessage(event);
  const lower = message.toLowerCase();
  let statusCode = explicitErrorStatus(event);
  if (!statusCode && COMMANDCODE_RATE_LIMIT_PATTERNS.some((pattern) => lower.includes(pattern))) {
    statusCode = HTTP_STATUS.RATE_LIMITED;
  } else if (!statusCode && COMMANDCODE_OVERLOAD_PATTERNS.some((pattern) => lower.includes(pattern))) {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
  }
  statusCode ||= HTTP_STATUS.SERVICE_UNAVAILABLE;
  return { statusCode, message, type: errorType(statusCode) };
}

function parseCommandCodeFrame(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const json = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!json || json === "[DONE]") return null;
  try { return JSON.parse(json); } catch { return null; }
}

function isPreambleEvent(event) {
  return COMMANDCODE_PREFLIGHT_PREAMBLE_EVENTS.has(event?.type);
}

function replayCommandCodeBody(reader, chunks, alreadyDone) {
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    releaseReader(reader);
  };
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (alreadyDone) {
        controller.close();
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      await cancelAndReleaseReader(reader, reason);
    },
  });
}

function replayResponse(originalResponse, reader, chunks, done) {
  return new Response(replayCommandCodeBody(reader, chunks, done), {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

function commandCodeErrorResponse(event) {
  const { statusCode, message, type } = parseCommandCodeError(event);
  return Response.json({ error: { message, type, code: statusCode } }, { status: statusCode });
}

/**
 * Inspect only a bounded, complete-frame prefix before releasing output.
 * Buffered chunks replay byte-for-byte; after a normal event, PR #3405 never
 * reclassifies later stream errors as HTTP failures.
 */
export async function preflightCommandCodeResponse(originalResponse) {
  if (!originalResponse?.ok || !originalResponse.body) return originalResponse;
  const reader = originalResponse.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  let bytes = 0;
  let frames = 0;

  try {
    while (bytes < COMMANDCODE_PREFLIGHT_MAX_BYTES && frames < COMMANDCODE_PREFLIGHT_MAX_FRAMES) {
      const { done, value } = await reader.read();
      if (done) {
        const event = parseCommandCodeFrame(text);
        if (event?.type === COMMANDCODE_EVENT.ERROR) {
          await cancelAndReleaseReader(reader, "CommandCode preflight error");
          return commandCodeErrorResponse(event);
        }
        releaseReader(reader);
        return replayResponse(originalResponse, reader, chunks, true);
      }

      chunks.push(value);
      const inspectBytes = Math.min(value.byteLength, COMMANDCODE_PREFLIGHT_MAX_BYTES - bytes);
      bytes += inspectBytes;
      text += decoder.decode(value.subarray(0, inspectBytes), { stream: true });

      let newline;
      while ((newline = text.indexOf("\n")) !== -1) {
        const line = text.slice(0, newline).replace(/\r$/, "");
        text = text.slice(newline + 1);
        if (!line.trim()) continue;
        frames += 1;
        const event = parseCommandCodeFrame(line);
        if (event?.type === COMMANDCODE_EVENT.ERROR) {
          await cancelAndReleaseReader(reader, "CommandCode preflight error");
          return commandCodeErrorResponse(event);
        }
        if (!event || !isPreambleEvent(event) || frames >= COMMANDCODE_PREFLIGHT_MAX_FRAMES) {
          return replayResponse(originalResponse, reader, chunks, false);
        }
      }
    }
    return replayResponse(originalResponse, reader, chunks, false);
  } catch (error) {
    await cancelAndReleaseReader(reader, error);
    throw error;
  }
}

/** Apply bounded PR #3405 error preflight before the existing NDJSON translator. */
export async function inspectAndWrapCommandCodeResponse(originalResponse, model) {
  const preflighted = await preflightCommandCodeResponse(originalResponse);
  return preflighted.ok && preflighted.body
    ? wrapNdjsonAsOpenAISse(preflighted, model)
    : preflighted;
}

export function wrapNdjsonAsOpenAISse(originalResponse, model) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model, rawTerminalSeen: false, failureSeen: false };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const emitFailure = (controller, message) => {
    if (state.failureSeen) return;
    state.failureSeen = true;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message, type: "stream_error" } })}\n\n`));
  };

  const processLine = (line, controller) => {
    const trimmed = line.trim();
    if (!trimmed || state.failureSeen) return;
    if (state.rawTerminalSeen) {
      emitFailure(controller, "CommandCode returned data after finish");
      return;
    }
    const json = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    let event;
    try {
      event = JSON.parse(json);
    } catch {
      emitFailure(controller, "CommandCode returned malformed stream data");
      return;
    }
    if (event?.type === COMMANDCODE_EVENT.ERROR) {
      emitFailure(controller, "CommandCode upstream stream failed");
      return;
    }
    if (event?.type === COMMANDCODE_EVENT.FINISH) state.rawTerminalSeen = true;
    emitChunks(commandCodeToOpenAIResponse(event, state), controller);
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line, controller);
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) processLine(trimmed, controller);
      if (!state.rawTerminalSeen && !state.failureSeen) {
        emitFailure(controller, "CommandCode stream ended before finish");
      }
      if (state.rawTerminalSeen && !state.failureSeen) {
        controller.enqueue(encoder.encode(SSE_DONE));
      }
    },
  });

  const newBody = originalResponse.body.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

export default CommandCodeExecutor;
