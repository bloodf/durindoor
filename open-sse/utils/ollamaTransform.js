// Transform an upstream stream to Ollama NDJSON (`application/x-ndjson`) lines.
//
// Upstream may be either:
//   1. OpenAI-style SSE (`data: {...}` / `data: [DONE]`) — converted to Ollama
//      message chunks below; or
//   2. Raw Ollama NDJSON (one bare JSON object per line) — passed through
//      unchanged. This happens when an ollama-local backend is hit via the
//      Ollama-compat `/api/chat` route: `handleStreamingResponse` passes the
//      native NDJSON through but labels the response `text/event-stream`, so
//      content-type alone cannot be trusted — each line is sniffed instead.
//
// SSE control lines (`event:`, `:` comments, blank lines) are ignored. A
// terminal `{done:true}` chunk is emitted exactly once — either from
// `data: [DONE]`, a `finish_reason`, an upstream `done:true` line, or flush
// if the stream ended without one — never twice. An upstream `{error: ...}`
// frame is terminal on its own: it is forwarded and suppresses any synthetic
// `done:true`, so a failed stream never looks like a clean completion.
import { projectCompletionToClientFormat } from "../translator/response/completionProjector.js";
import { FORMATS } from "../translator/formats.js";

// Normalize internal {error: {message, type, code}} and Ollama-native {error: string}
// frames to the Ollama wire shape {error: string}. Never returns null for an
// actual error; falls back to a safe string so the client sees a frame instead
// of an empty truncated stream.
import { isBoolean, isObject, isString } from "@/shared/utils/typeChecks.js";function normalizeError(error) {
  if (error == null) return { error: "Upstream error" };
  if (isString(error)) return { error: error };
  if (isObject(error)) {
    if (isString(error.message)) return { error: error.message };
    try {
      return { error: JSON.stringify(error) };
    } catch {
      return { error: "Upstream error" };
    }
  }
  return { error: String(error) };
}

// True for both Ollama-native {error: string} and internal {error: {message, ...}}.
function isErrorFrame(parsed) {
  return parsed && isObject(parsed) && !Array.isArray(parsed) && Object.hasOwn(parsed, "error");
}

export function transformToOllama(response, model) {
  let buffer = "";
  let pendingToolCalls = {};
  let ended = false;
  // One persistent decoder across chunks so multi-byte UTF-8 sequences split
  // across chunk boundaries decode correctly (stream: true).
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const terminalLine = () => JSON.stringify({ model, message: { role: "assistant", content: "" }, done: true }) + "\n";

  const emitTerminalOnce = (controller) => {
    if (ended) return;
    ended = true;
    controller.enqueue(encoder.encode(terminalLine()));
  };

  // Process one complete line (already trimmed). Shared by transform + flush.
  const processLine = (trimmed, controller) => {
    // Skip SSE control lines, comments, and blanks.
    if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return;

    if (trimmed.startsWith("data:")) {
      const data = trimmed.slice(5).trim();

      if (data === "[DONE]") {
        emitTerminalOnce(controller);
        return;
      }

      try {
        const parsed = JSON.parse(data);
        // Upstream error embedded in an SSE data line (OpenAI wire error, or an
        // internal {error: {message, type, code}} object): forward as a native
        // Ollama error frame. This is terminal and suppresses synthetic done:true.
        if (isErrorFrame(parsed)) {
          const normalized = normalizeError(parsed.error);
          ended = true;
          controller.enqueue(encoder.encode(JSON.stringify(normalized) + "\n"));
          return;
        }

        const delta = parsed.choices?.[0]?.delta || {};
        const content = delta.content || "";
        const thinking = delta.reasoning_content || delta.thinking || "";
        const toolCalls = delta.tool_calls;

        if (toolCalls) {
          for (const tc of toolCalls) {
            const idx = tc.index;
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
            }
            if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
          }
        }

        if (thinking) {
          const ollama = JSON.stringify({
            model,
            message: { role: "assistant", content: "", thinking },
            done: false
          }) + "\n";
          controller.enqueue(encoder.encode(ollama));
        }

        if (content) {
          const ollama = JSON.stringify({ model, message: { role: "assistant", content }, done: false }) + "\n";
          controller.enqueue(encoder.encode(ollama));
        }

        const finishReason = parsed.choices?.[0]?.finish_reason;
        if (finishReason === "tool_calls" || finishReason === "stop") {
          const toolCallsArr = Object.values(pendingToolCalls);
          if (toolCallsArr.length > 0) {
            const formattedCalls = toolCallsArr.map((tc) => ({
              function: {
                name: tc.function.name,
                arguments: (() => {try {return JSON.parse(tc.function.arguments || "{}");} catch {return {};}})()
              }
            }));
            const ollama = JSON.stringify({
              model,
              message: { role: "assistant", content: "", tool_calls: formattedCalls },
              done: true
            }) + "\n";
            controller.enqueue(encoder.encode(ollama));
            ended = true;
            pendingToolCalls = {};
          } else if (finishReason === "stop") {
            emitTerminalOnce(controller);
          }
        }
      } catch (e) {

        // Silently ignore SSE data parse errors
      }return;
    }

    // Not an SSE line — sniff a bare JSON line (native Ollama NDJSON or an
    // upstream error object). Forward valid JSON objects unchanged so Ollama
    // chunks and `{error: ...}` frames reach the client as-is.
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || !isObject(parsed) || Array.isArray(parsed)) return;
        // A buffered OpenAI chat completion (the route's stream:false path
        // returns one JSON object, not a stream): convert to a native Ollama
        // non-stream response instead of dropping it, or the client gets an
        // empty synthetic done with no content.
        if (Array.isArray(parsed.choices) && parsed.choices[0]?.message) {
          const projected = projectCompletionToClientFormat(parsed, FORMATS.OLLAMA);
          controller.enqueue(encoder.encode(JSON.stringify(projected) + "\n"));
          ended = true;
          return;
        }
        // Forward only Ollama-shaped NDJSON objects (message chunk, terminal
        // done frame, or error frame). Any other bare JSON is not a valid
        // Ollama stream object and is dropped rather than passed through to
        // clients as a mixed-format line.
        const hasError = isErrorFrame(parsed);
        if ("message" in parsed || isBoolean(parsed.done) || hasError) {
          if (parsed.done === true || hasError) ended = true;
          if (hasError) {
            const normalized = normalizeError(parsed.error);
            controller.enqueue(encoder.encode(JSON.stringify(normalized) + "\n"));
          } else {
            controller.enqueue(encoder.encode(trimmed + "\n"));
          }
        }
      } catch (e) {

        // Incomplete/invalid JSON line — drop it, never emit garbage.
      }}
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line.trim(), controller);
    },
    flush(controller) {
      // Flush any trailing multi-byte bytes held by the streaming decoder,
      // then process a final line that ended without a newline.
      buffer += decoder.decode();
      const rest = buffer.trim();
      buffer = "";
      if (rest) processLine(rest, controller);
      emitTerminalOnce(controller);
    }
  });

  if (!response.body) {
    return new Response("", { status: response.status, headers: { "Content-Type": "application/x-ndjson" } });
  }
  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" }
  });
}