import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";

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
    result.response = wrapNdjsonAsOpenAISse(result.response, opts.model);
    result.terminalProvenance = "validated";
    return result;
  }
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
    if (event?.type === "error") {
      emitFailure(controller, "CommandCode upstream stream failed");
      return;
    }
    if (event?.type === "finish") state.rawTerminalSeen = true;
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
