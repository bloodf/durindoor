import { FORMATS } from "open-sse/translator/formats.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK } from "open-sse/translator/schema/blocks.js";
import { ROLE } from "open-sse/translator/schema/roles.js";
import { createUpstreamTerminalTracker, isCoherentNonStreamingResponse } from "open-sse/utils/streamTerminal.js";
import {
  CAPTURE_TURN_BYTES, createCaptureTextRedactor, normalizeCaptureSessionId, storeAdmittedCapture,
} from "@/lib/db/repos/sessionCaptureRepo.js";
import { isString } from "@/shared/utils/typeChecks.js";
import { extractApiKeyCandidates } from "../services/auth.js";

export const CAPTURE_CONSENT_HEADER = "x-durindoor-capture";
export const CAPTURE_SESSION_HEADER = "x-durindoor-capture-session";

const MAX_DOCUMENT = 64 * 1024;
const MAX_STREAM_INDEX = 127;
const TEXT_DELTA = "text_delta";

function appendText(content, append) {
  if (isString(content)) append(content);
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === OPENAI_BLOCK.TEXT && isString(block.text)) append(block.text);
  }
}

function observeSse(format, expectedChoiceCount, append) {
  const terminal = createUpstreamTerminalTracker({ format, expectedChoiceCount });
  let lineBuffer = "";
  let data = "";
  let eventName = null;
  let claudeStarted = false;
  const claudeTextBlocks = new Set();

  function dispatch() {
    if (eventName === "error") throw new Error("Capture stream failed");
    if (!data) return;
    const rawDone = data.trim() === "[DONE]";
    const chunk = rawDone ? null : JSON.parse(data);
    terminal.observe({ chunk, eventName, rawDone });
    if (terminal.outcome === "failure") throw new Error("Capture stream failed");
    if (format === FORMATS.CLAUDE) {
      if (chunk?.type === "message_start") {
        if (claudeStarted || chunk.message?.role !== ROLE.ASSISTANT) throw new Error("Invalid assistant message start");
        claudeStarted = true;
        chunk.message.content?.forEach((block, index) => appendText([block], (text) => append(index, text)));
      }
      if (chunk?.type === "content_block_start" && claudeStarted && chunk.content_block?.type === CLAUDE_BLOCK.TEXT) {
        append(chunk.index, chunk.content_block.text);
        claudeTextBlocks.add(chunk.index);
      }
      if (chunk?.type === "content_block_stop") claudeTextBlocks.delete(chunk.index);
      if (chunk?.type === "content_block_delta" && claudeTextBlocks.has(chunk.index) && chunk.delta?.type === TEXT_DELTA) {
        appendText(chunk.delta.text, (text) => append(chunk.index, text));
      }
    } else {
      chunk?.choices?.forEach((choice, position) => {
        const index = choice?.index ?? position;
        if (!Number.isInteger(index) || index < 0 || index > MAX_STREAM_INDEX) throw new Error("Invalid choice index");
        if (!choice.delta?.role || choice.delta.role === ROLE.ASSISTANT) {
          appendText(choice.delta?.content, (text) => append(index, text));
        }
      });
    }
  }

  return {
    feed(text) {
      lineBuffer += text;
      // Leave a trailing CR buffered until the next chunk can disambiguate CRLF.
      const lines = lineBuffer.split(/\r\n|\r(?!$)|\n/);
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (line.length > MAX_DOCUMENT) throw new Error("Capture frame exceeds limit");
        if (!line) {
          dispatch();
          data = "";
          eventName = null;
        } else if (line.startsWith("data:")) {
          data += line.slice(5).replace(/^ /, "") + "\n";
          if (data.length > MAX_DOCUMENT) throw new Error("Capture frame exceeds limit");
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        }
      }
      if (lineBuffer.length > MAX_DOCUMENT) throw new Error("Capture frame exceeds limit");
    },
    finish() {
      if (lineBuffer.endsWith("\r")) this.feed("\n");
      return !lineBuffer && !data && !eventName && terminal.outcome === "success" &&
        (format !== FORMATS.CLAUDE || claudeStarted && claudeTextBlocks.size === 0);
    },
  };
}

/** Observe the single response selected by routing, on the client's read path. */
export function prepareMessageCapture({ request, body, settings, auth, credential, format }) {
  if (settings.enableSessionCapture !== true || auth.ok !== true || auth.stored !== true ||
      !auth.apiKeyId || !credential || request.headers.get(CAPTURE_CONSENT_HEADER) !== "true") return null;
  const session = normalizeCaptureSessionId(request.headers.get(CAPTURE_SESSION_HEADER));
  if (!session) return null;
  const path = new URL(request.url).pathname;
  if (!/^\/(?:api\/)?(?:v1\/){1,2}(?:messages|chat\/completions)\/?$/.test(path) ||
      (format !== FORMATS.OPENAI && format !== FORMATS.CLAUDE)) return null;

  const credentials = [...new Set([credential, ...extractApiKeyCandidates(request), request.headers.get("authorization")])].filter(Boolean);
  // An imported credential can itself be a UUID. Never persist it as an identifier.
  if (credentials.some((value) =>
    value.length > CAPTURE_TURN_BYTES || value.toLowerCase() === session || value === auth.apiKeyId
  )) return null;

  let size = 0;
  const count = (text) => {
    size += Buffer.byteLength(text);
    if (size > CAPTURE_TURN_BYTES) throw new Error("Capture text exceeds limit");
  };
  const user = [];
  try {
    for (const message of body.messages || []) {
      if (message?.role !== ROLE.USER) continue;
      let content = "";
      appendText(message.content, (text) => {
        count(text);
        content += text;
      });
      if (content) user.push(content);
    }
  } catch {
    return null;
  }

  const { apiKeyId: keyId, billingEpoch } = auth;
  const expectedChoiceCount = body.n;
  return (response) => {
    if (!response?.ok || !response.body || response.body.locked) return response;
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    if (type !== "text/event-stream" && type !== "application/json") return response;
    const assistant = new Map();
    const append = (index, text) => {
      if (!Number.isInteger(index) || index < 0 || index > MAX_STREAM_INDEX) throw new Error("Invalid capture index");
      if (!isString(text) || !text) return;
      count(text);
      assistant.set(index, (assistant.get(index) || "") + text);
    };
    const stream = type === "text/event-stream" ? observeSse(format, expectedChoiceCount, append) : null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let json = "";
    let observing = true;
    const feed = (text) => {
      if (stream) stream.feed(text);
      else {
        json += text;
        if (json.length > MAX_DOCUMENT) throw new Error("Capture document exceeds limit");
      }
    };

    const tap = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        if (!observing) return;
        try {
          // Bound parser allocations even if a provider sends one large chunk.
          for (let offset = 0; offset < chunk.length; offset += MAX_DOCUMENT) {
            feed(decoder.decode(chunk.subarray(offset, offset + MAX_DOCUMENT), { stream: true }));
          }
        } catch {
          observing = false;
          assistant.clear();
          json = "";
        }
      },
      flush() {
        if (!observing || request.signal.aborted) return;
        try {
          feed(decoder.decode());
          if (stream) {
            if (!stream.finish()) return;
          } else {
            const message = JSON.parse(json);
            if (!isCoherentNonStreamingResponse(message, format)) return;
            if (format === FORMATS.CLAUDE) {
              if (message.role !== ROLE.ASSISTANT) return;
              appendText(message.content, (text) => append(0, text));
            } else {
              message.choices.forEach((choice, position) => {
                if (choice.message?.role === ROLE.ASSISTANT) {
                  appendText(choice.message.content, (text) => append(choice.index ?? position, text));
                }
              });
            }
          }
          const replies = [...assistant].sort(([left], [right]) => left - right).map(([, text]) => text);
          if (!user.length && !replies.length) return;
          const assistantText = format === FORMATS.CLAUDE && replies.length ? [replies.join("")] : replies;
          const redactText = createCaptureTextRedactor(credentials);
          const content = JSON.stringify({ user: user.map(redactText), assistant: assistantText.map(redactText) });
          // Start storage without awaiting it on the response path.
          void storeAdmittedCapture({ keyId, session, billingEpoch, content }).catch(() => {});
        } catch {
          // Observation is best effort, including malformed or oversized data.
        }
      },
    });
    return new Response(response.body.pipeThrough(tap), response);
  };
}
