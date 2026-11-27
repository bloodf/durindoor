/** Internal ChatGPT Web conversation-detail helpers; public compatibility exports live in ../chatgpt-web-http.js. */
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { tlsFetchChatGpt, CHATGPT_BASE, browserHeaders, oaiHeaders, configuredProPollTimeoutMs, configuredProPollIntervalMs } from "./session.js";

export const UPLOAD_PLACEHOLDER_POINTER_RE = /^(?:(?:file-service|sediment):\/\/)?file_upload/;

export function isImagePointer(value) {
  return isString(value) && !UPLOAD_PLACEHOLDER_POINTER_RE.test(value);
}

export function extractImagePointers(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || !isObject(p)) continue;
    const obj = p;
    if (obj.content_type === "image_asset_pointer" && isImagePointer(obj.asset_pointer)) {
      out.push(obj.asset_pointer);
    }
  }
  return out;
}

async function* extractContent(eventStream, signal) {
  // ChatGPT may echo prior assistant turns at the start of the stream with
  // status: "finished_successfully" and full content, before sending the new
  // generation. If we emit those bytes downstream, streaming consumers see
  // the previous answer prepended to the new one (visible in Open WebUI as
  // run-on output across turns). Strategy: only emit deltas after we've seen
  // status === "in_progress" for the current message id (i.e., it's being
  // generated live in this stream). Echoes always arrive already finished
  // and never transition through in_progress, so they get suppressed. An
  // end-of-stream fallback handles the rare case where a real turn arrives
  // as a single already-finished event (instant/cached responses).
  let conversationId = null;
  let currentId = null;
  let currentParts = "";
  let currentMetadata;
  let emittedLen = 0;
  let isLive = false;
  // Dedupe pointers across echoes / repeated events. Order-preserving Set.
  const imagePointers = new Map();
  // True if we observed signals the assistant kicked off the async image_gen
  // tool (see ContentChunk.imageGenAsync). The actual image arrives later via
  // WebSocket / polling — caller handles that.
  let imageGenAsync = false;
  let handoff = false;
  let resumeToken = null;

  for await (const event of readChatGptSseEvents(eventStream, signal)) {
    if (event.error) {
      const msg =
        isString(event.error)
          ? event.error
          : event.error.message || "ChatGPT stream error";
      yield { error: msg, done: true };
      return;
    }

    if (event.conversation_id) conversationId = event.conversation_id;

    if (event.type === "resume_conversation_token") {
      if (isString(event.token) && event.token) resumeToken = event.token;
      continue;
    }

    if (event.type === "stream_handoff") {
      handoff = true;
      yield {
        conversationId: conversationId ?? undefined,
        handoff: true,
        resumeToken: resumeToken ?? undefined,
      };
      continue;
    }

    // Detect image_gen on top-level "server_ste_metadata" events. These don't
    // have a `message` field so the post-message guard would skip them, but
    // they're the most reliable signal — `turn_use_case: "image gen"`.
    //
    // Originally we also accepted `meta.tool_invoked === true`, but ChatGPT
    // sets that flag for ANY internal tool the assistant uses (reasoning
    // chains, web search, calc, file_search, etc.). That made plain text
    // turns spuriously emit the "Generating image…" placeholder + 30s
    // WebSocket wait. Image gen has a more specific signal we can rely on:
    // either `turn_use_case === "image gen"` here, or an `image_gen_task_id`
    // on a tool-role message (handled below).
    if (event.type === "server_ste_metadata") {
      const meta = event.metadata;
      if (meta && meta.turn_use_case === "image gen") {
        imageGenAsync = true;
      }
    }

    const m = event.message;
    if (!m) continue;

    // Tool messages with `image_gen_task_id` in metadata (the "Processing
    // image..." card) confirm the async image_gen flow. We don't surface the
    // tool message itself as text — it's just a placeholder — but we mark
    // imageGenAsync so the executor knows to poll for the final image.
    if (m.metadata && isString(m.metadata.image_gen_task_id)) {
      imageGenAsync = true;
    }

    if (m.author?.role !== "assistant") continue;

    const id = m.id ?? null;
    const status = m.status ?? "";

    if (id && id !== currentId) {
      currentId = id;
      currentParts = "";
      currentMetadata = undefined;
      emittedLen = 0;
      isLive = false;
    }

    if (m.metadata && isObject(m.metadata)) {
      currentMetadata = m.metadata;
    }

    if (status === "in_progress") {
      isLive = true;
    }

    const parts = m.content?.parts ?? [];
    if (parts.length === 0) continue;

    // Image asset pointers: only collect once the message is finalized
    // (status === "finished_successfully"). The same pointer may also appear
    // on echoed prior turns at the head of the stream; that's fine — the Set
    // dedupes, and the resolver in the executor produces the same URL either
    // way. We could restrict to isLive-only to avoid resolving echoes, but
    // that makes single-event instant responses (no in_progress phase) lose
    // their image. Letting echoes through is harmless for correctness; the
    // executor resolves each unique pointer at most once.
    if (status === "finished_successfully" || status === "" || isLive) {
      for (const ptr of extractImagePointers(parts)) {
        const existing = imagePointers.get(ptr);
        imagePointers.set(
          ptr,
          existing?.messageId ? existing : imagePointerEntry(ptr, id)
        );
      }
    }

    const cumulative = parts.map((p) => (isString(p) ? p : "")).join("");
    if (cumulative.length > currentParts.length) {
      currentParts = cumulative;
    }

    if (isLive && currentParts.length > emittedLen) {
      const delta = currentParts.slice(emittedLen);
      emittedLen = currentParts.length;
      yield {
        delta,
        answer: currentParts,
        conversationId: conversationId ?? undefined,
        messageId: currentId ?? undefined,
        metadata: currentMetadata,
      };
    }
  }

  // End-of-stream fallback: if we never observed status === "in_progress"
  // for the current id (single-event reply, cached/instant response), emit
  // the accumulated content now so the consumer doesn't get an empty stream.
  if (!isLive && currentParts.length > emittedLen) {
    yield {
      delta: currentParts.slice(emittedLen),
      answer: currentParts,
      conversationId: conversationId ?? undefined,
      messageId: currentId ?? undefined,
      metadata: currentMetadata,
    };
  }

  yield {
    delta: "",
    answer: currentParts,
    conversationId: conversationId ?? undefined,
    messageId: currentId ?? undefined,
    metadata: currentMetadata,
    imagePointers: imagePointers.size > 0 ? Array.from(imagePointers.values()) : undefined,
    imageGenAsync,
    handoff,
    resumeToken: resumeToken ?? undefined,
    done: true,
  };
}

// ─── Long-running Pro handoff polling ──────────────────────────────────────

export function textFromContentPart(part) {
  if (isString(part)) return part;
  if (!part || !isObject(part)) return "";
  const obj = part;
  for (const key of ["text", "content", "summary"]) {
    const value = obj[key];
    if (isString(value)) return value;
  }
  return "";
}

export function detailMessageText(message) {
  const content = message.content;
  if (!content) return "";
  if (isString(content.text)) return content.text;
  const parts = content.parts ?? [];
  return parts.map(textFromContentPart).join("");
}

export function extractFinalAssistantAnswer(detail) {
  const nodes = Object.values(detail.mapping ?? {});
  let best = null;

  for (const node of nodes) {
    const message = node.message;
    if (!message || message.author?.role !== "assistant") continue;
    if (message.metadata?.is_visually_hidden === true) continue;
    const contentType = message.content?.content_type ?? "";
    if (contentType.includes("thought") || contentType.includes("reasoning")) continue;

    const text = detailMessageText(message).trim();
    if (!text) continue;
    const finished = message.status === "finished_successfully" && message.end_turn !== false;
    const sort = message.update_time ?? message.create_time ?? 0;
    if (
      !best ||
      (finished && (!best.finished || sort >= best.sort)) ||
      (!finished && !best.finished && sort >= best.sort)
    ) {
      best = { text, messageId: message.id, metadata: message.metadata, finished, sort };
    }
  }

  if (!best) return null;
  return {
    text: best.text,
    messageId: best.messageId,
    metadata: best.metadata,
    finished: best.finished,
  };
}

export function delayWithAbort(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function decodeUtf8DataUrl(text) {
  const marker = ";base64,";
  if (!text.startsWith("data:") || !text.includes(marker)) return text;
  const base64 = text.slice(text.indexOf(marker) + marker.length);
  return new TextDecoder().decode(Buffer.from(base64, "base64"));
}

export async function fetchConversationDetail(conversationId, ctx) {
  const url = `${CHATGPT_BASE}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  try {
    const response = await tlsFetchChatGpt(url, {
      method: "GET",
      headers,
      timeoutMs: 30_000,
      signal: ctx.signal,
      // The native tls-client text path can surface UTF-8 JSON as mojibake
      // (e.g. 👉 becomes ðŸ‘‰). Ask for raw bytes and decode as UTF-8 here so
      // the final answer appended after Pro stream_handoff preserves Unicode.
      byteResponse: true,
    });
    if (response.status >= 400) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `conversation poll ${response.status}: ${(response.text || "").slice(0, 300)}`
      );
      return { detail: null, terminal: [401, 403, 404].includes(response.status) };
    }
    if (!response.text) return { detail: null, terminal: false };
    return {
      detail: JSON.parse(decodeUtf8DataUrl(response.text)),
      terminal: false,
    };
  } catch (err) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `conversation poll failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { detail: null, terminal: false };
  }
}

export async function pollForFinalAssistantAnswer(conversationId, ctx) {
  const started = Date.now();
  const timeoutMs = configuredProPollTimeoutMs();
  const intervalMs = configuredProPollIntervalMs();
  let last = null;
  let terminalPollFailure = false;

  while (!ctx.signal?.aborted && Date.now() - started < timeoutMs) {
    const { detail, terminal } = await fetchConversationDetail(conversationId, ctx);
    if (detail) {
      const answer = extractFinalAssistantAnswer(detail);
      if (answer) {
        last = answer;
        if (answer.finished) return answer;
      }
    }
    if (terminal) {
      terminalPollFailure = true;
      break;
    }
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await delayWithAbort(Math.min(intervalMs, remaining), ctx.signal);
  }

  if (last) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      terminalPollFailure
        ? `conversation poll stopped before finished_successfully; returning latest assistant text for ${conversationId}`
        : `conversation poll timed out before finished_successfully; returning latest assistant text for ${conversationId}`
    );
  } else {
    ctx.log?.warn?.(
      "CGPT-WEB",
      terminalPollFailure
        ? `conversation poll stopped without assistant text for ${conversationId}`
        : `conversation poll timed out without assistant text for ${conversationId}`
    );
  }
  return last;
}

// ─── OpenAI SSE format ──────────────────────────────────────────────────────


export function imagePointerEntry(pointer, messageId) {
  const entry = { pointer };
  if (messageId) entry.messageId = messageId;
  return entry;
}

