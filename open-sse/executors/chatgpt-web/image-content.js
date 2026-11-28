/** ChatGPT Web SSE content reader. Yields text deltas plus the image signal the executor needs. */
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { readChatGptSseEvents } from "./conversation.js";
import { extractImagePointers, imagePointerEntry } from "./image-pointers.js";


// ─── Content extraction ─────────────────────────────────────────────────────
// ChatGPT SSE chunks contain CUMULATIVE content (full text so far in `parts[0]`),
// not deltas. Diff against the emitted length to produce incremental tokens —
// same pattern perplexity-web.js uses for markdown blocks (lines 386-397).

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


export { extractContent };
