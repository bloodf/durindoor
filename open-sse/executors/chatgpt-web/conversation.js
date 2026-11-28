/** ChatGPT Web conversation helpers. The HTTP entry preserves the public transport API. */
import { randomUUID } from "node:crypto";
import { getChatGptImageConversationContext } from "../../services/chatgptImageCache.js";
import { buildNextAuthSessionCookie } from "../../../src/lib/providers/webCookieAuth.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { tlsFetchChatGpt, CHATGPT_BASE, browserHeaders, oaiHeaders, configuredProPollTimeoutMs, configuredProPollIntervalMs } from "./session.js";


// ─── OpenAI → ChatGPT message translation ───────────────────────────────────

/**
 * Strip embedded `data:image/...` URIs out of message content so prior
 * generated images don't get fed back into chatgpt.com on the next turn.
 *
 * Why: when image generation succeeds we emit `![image](data:image/png;base64,...)`
 * — frequently 2–4 MB. Chat clients (Open WebUI, OpenAI-style apps) replay
 * the full conversation history on the next request, so without this strip
 * we'd send megabytes of base64 back upstream. chatgpt.com responds with an
 * empty body when that happens (verified: 502 "ChatGPT returned empty
 * response body" on the very next turn after an image gen succeeds), and
 * even if it didn't, a single inlined image is well past the model's context
 * limit. Replacing with a short placeholder keeps semantic continuity
 * without the bytes.
 */
const DATA_URI_IMAGE_RE = /!\[([^\]]*)\]\(data:image\/[^)]+\)/g;

const CACHED_IMAGE_URL_RE = /\/v1\/chatgpt-web\/image\/([a-f0-9]{16,64})(?=[)\s"'<>]|$)/gi;


function stripInlinedImages(content) {
  return content.replace(DATA_URI_IMAGE_RE, (_, alt) =>
    alt ? `[${alt}: generated image]` : "[generated image]"
  );
}


function findCachedImageContext(content, owner) {
  let latest = null;
  // String.prototype.matchAll consumes a fresh iterator and ignores the
  // regex's lastIndex, so no manual reset is required.
  for (const match of content.matchAll(CACHED_IMAGE_URL_RE)) {
    const id = match[1];
    const context = getChatGptImageConversationContext(id, owner?.apiKeyId, owner?.connectionId);
    if (context) latest = context;
  }
  return latest;
}


function parseOpenAIMessages(messages, owner) {
  let systemMsg = "";
  const history = [];
  let latestImageContext = null;

  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";

    let content = "";
    if (isString(msg.content)) {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c.type === "text")
        .map((c) => String(c.text || ""))
        .join(" ");
    }
    content = stripInlinedImages(content);
    const imageContext = findCachedImageContext(content, owner);
    if (imageContext) latestImageContext = imageContext;
    if (!content.trim()) continue;

    if (role === "system") {
      systemMsg += (systemMsg ? "\n" : "") + content;
    } else if (role === "user" || role === "assistant") {
      history.push({ role, content });
    }
  }

  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }

  return { systemMsg, history, currentMsg, latestImageContext };
}


/**
 * Cheap heuristic: does the last user turn look like an image-generation
 * request? Used to decide whether to disable Temporary Chat mode.
 *
 * Why a heuristic instead of always disabling Temporary Chat: when
 * `history_and_training_disabled: false`, every conversation gets saved to
 * the user's chatgpt.com history. For text-only chats that's noise — a
 * dozen "DurinDoor" entries clutter the sidebar and can interact with
 * ChatGPT's memory. We pay that cost only when the user actually wants an
 * image, since Temporary Chat refuses image_gen with the message
 * "I cannot generate images in this chat".
 *
 * False positives (text chat misclassified as image) → unnecessary history
 * entry. False negatives (image request misclassified as text) → ChatGPT
 * refuses image_gen and the user retries. Tuning leans toward false
 * positives (we'd rather pollute history than refuse image generation).
 */
const IMAGE_GEN_REGEXES = [
  // verb + (anything within 40 chars) + image-noun
  /\b(?:generate|create|make|draw|paint|render|produce|design|sketch|illustrate|show me)\b[\s\S]{0,40}\b(?:image|picture|photo|photograph|drawing|illustration|sketch|painting|portrait|logo|icon|art|artwork|wallpaper|render|graphic)\b/i,
  // image-noun + "of" — "image of a kitten", "picture of mountains"
  /\b(?:image|picture|photo|photograph|illustration|drawing|painting|render)\s+of\b/i,
  // direct verb + a/an article — "draw a kitten", "paint an apple"
  /\b(?:draw|paint|sketch|render|illustrate)\s+(?:me\s+)?(?:a|an|some|the)\s+\w+/i,
  // explicit slash command users sometimes type — "/imagine ..."
  /^\s*\/(?:image|imagine|img|draw|paint)\b/im,
];


/**
 * Markers Open WebUI uses for its background tool prompts (follow-up
 * suggestions, title generation, tag categorization). These prompts embed
 * the prior conversation in `<chat_history>` blocks and frequently quote
 * the user's earlier "generate an image of..." request — which would
 * trip the image-gen regex below. Skip them so we don't unnecessarily
 * disable Temporary Chat and trigger image_gen on background tasks.
 *
 * Catching just one of these markers is enough; tool prompts always
 * include several together.
 */
const OPENWEBUI_TOOL_PROMPT_MARKERS = [
  /<chat_history>/i,
  /^### Task:/im,
  /\bJSON format:\s*\{/i,
  /\bfollow_?ups\b.*\barray of strings\b/i,
];


const OPENWEBUI_IMAGE_CONTEXT_MARKERS = [
  /<context>\s*The requested image has been (?:created|edited and created) by the system successfully/i,
  /<context>\s*The requested image has been edited and created and is now being shown to the user/i,
  /<context>\s*Image generation was attempted but failed/i,
];


function hasOpenWebUIImageContext(parsed) {
  return OPENWEBUI_IMAGE_CONTEXT_MARKERS.some((re) => re.test(parsed.systemMsg));
}


function looksLikeImageGenRequest(parsed) {
  // Inspect only the latest user turn — historical turns are irrelevant
  // (and could trigger false positives if the user mentioned an image
  // generated previously).
  const text = parsed.currentMsg.trim();
  if (!text) return false;
  if (OPENWEBUI_TOOL_PROMPT_MARKERS.some((re) => re.test(text))) return false;
  if (hasOpenWebUIImageContext(parsed)) return false;
  return IMAGE_GEN_REGEXES.some((re) => re.test(text));
}


const IMAGE_EDIT_REGEXES = [
  /\b(?:edit|adjust|modify|change|update|alter|revise|retouch|fix)\b[\s\S]{0,120}\b(?:it|image|picture|photo|lighting|background|style|color|colour|composition|scene|time of day)\b/i,
  /\b(?:make|turn|set|switch)\s+(?:it|the\s+(?:image|picture|photo|scene))\b[\s\S]{0,120}\b/i,
  /\b(?:add|remove|replace)\b[\s\S]{0,120}\b(?:it|image|picture|photo|background|sky|person|object|text|logo)\b/i,
  /\b(?:brighter|darker|night|daytime|time of day|sunset|sunrise|morning|evening|lighting|relight|background|style)\b/i,
  /^\s*(?:now|then|also)\b[\s\S]{0,120}\b(?:make|turn|change|adjust|add|remove|replace|edit)\b/i,
];


function looksLikeImageEditRequest(parsed) {
  if (!parsed.latestImageContext) return false;
  const text = parsed.currentMsg.trim();
  if (!text) return false;
  if (OPENWEBUI_TOOL_PROMPT_MARKERS.some((re) => re.test(text))) return false;
  if (hasOpenWebUIImageContext(parsed)) return false;
  return IMAGE_EDIT_REGEXES.some((re) => re.test(text));
}


function buildConversationBody(parsed, modelSlug, parentMessageId, options) {
  // Critical: do NOT send prior turns as separate `assistant` and `user`
  // messages in the `messages` array. ChatGPT's web API ("action: next")
  // treats those as in-progress turns and the model will literally CONTINUE
  // a prior assistant response in the new generation — observed as
  // `[1] -> [12] -> [1123]` across three turns.
  //
  // Instead, fold all prior history into the system message and send only
  // the current user message as a single new turn. The model then sees a
  // single prompt with full context and responds fresh.
  const systemParts = [];
  if (parsed.systemMsg.trim()) {
    systemParts.push(parsed.systemMsg.trim());
  }
  const continuation = options.continuation ?? null;

  if (!continuation && parsed.history.length > 0) {
    const formatted = parsed.history
      .map((h) => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`)
      .join("\n\n");
    systemParts.push(
      `Prior conversation (for context — answer only the new user message below):\n\n${formatted}`
    );
  }

  const messages = [];
  if (systemParts.length > 0) {
    messages.push({
      id: randomUUID(),
      author: { role: "system" },
      content: { content_type: "text", parts: [systemParts.join("\n\n")] },
    });
  }

  const systemHints = options.systemHints;

  const currentUserContent = hasOpenWebUIImageContext(parsed)
    ? "Briefly acknowledge the image result described in the system context. Do not generate, edit, or request another image."
    : parsed.currentMsg || "";

  const currentUserMessage = {
    id: randomUUID(),
    author: { role: "user" },
    content: { content_type: "text", parts: [currentUserContent] },
  };
  if (systemHints.length > 0) currentUserMessage.metadata = { system_hints: [...systemHints] };
  messages.push(currentUserMessage);

  const conversationBody = {
    action: "next",
    messages,
    model: modelSlug,
    // Text-only API-style requests start fresh because clients replay full
    // history. Generated-image edits are the exception: ChatGPT needs the
    // original conversation node to adjust the actual image, not just a
    // markdown URL echoed back in a synthetic history block.
    conversation_id: continuation?.conversationId ?? null,
    parent_message_id: continuation?.parentMessageId ?? parentMessageId,
    timezone_offset_min: -new Date().getTimezoneOffset(),
    // Temporary Chat is the default. Disable it only for image generation /
    // image edits, where ChatGPT needs durable conversation state for tools.
    history_and_training_disabled: !options.persistConversation,
    suggestions: [],
    websocket_request_id: randomUUID(),
    conversation_mode: { kind: "primary_assistant" },
    supports_buffering: true,
    force_parallel_switch: "auto",
    paragen_cot_summary_display_override: "allow",
  };
  if (systemHints.length > 0) conversationBody.system_hints = [...systemHints];
  if (options.thinkingEffort) conversationBody.thinking_effort = options.thinkingEffort;
  return conversationBody;
}


// ─── ChatGPT SSE parsing ────────────────────────────────────────────────────

/**
 * A part inside `content.parts` for a `multimodal_text` content_type.
 * ChatGPT puts image references in a part with content_type "image_asset_pointer"
 * and an asset_pointer like "file-service://file-XXXX" (final) or
 * "sediment://..." (in-progress preview).
 */
async function* readChatGptSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let eventName = null;

  function flush() {
    if (dataLines.length === 0) {
      eventName = null;
      return null;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    const sseEventName = eventName;
    eventName = null;
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return "done";
    try {
      const parsed = JSON.parse(trimmed);
      if (sseEventName && !parsed.type) parsed.type = sseEventName;
      return parsed;
    } catch {
      console.warn("[chatgpt-web] stream event JSON parse failed");
      return null;
    }
  }

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "") {
          const parsed = flush();
          if (parsed === "done") return;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) {
      dataLines.push(buffer.trim().slice(5).trimStart());
    }
    const tail = flush();
    if (tail && tail !== "done") yield tail;
  } finally {
    reader.releaseLock();
  }
}


// ─── Long-running Pro handoff polling ──────────────────────────────────────

function textFromContentPart(part) {
  if (isString(part)) return part;
  if (!part || !isObject(part)) return "";
  const obj = part;
  for (const key of ["text", "content", "summary"]) {
    const value = obj[key];
    if (isString(value)) return value;
  }
  return "";
}


function detailMessageText(message) {
  const content = message.content;
  if (!content) return "";
  if (isString(content.text)) return content.text;
  const parts = content.parts ?? [];
  return parts.map(textFromContentPart).join("");
}


function extractFinalAssistantAnswer(detail) {
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


function delayWithAbort(ms, signal) {
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


function decodeUtf8DataUrl(text) {
  const marker = ";base64,";
  if (!text.startsWith("data:") || !text.includes(marker)) return text;
  const base64 = text.slice(text.indexOf(marker) + marker.length);
  return new TextDecoder().decode(Buffer.from(base64, "base64"));
}


async function fetchConversationDetail(conversationId, ctx) {
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


async function pollForFinalAssistantAnswer(conversationId, ctx) {
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

export { parseOpenAIMessages, looksLikeImageGenRequest, looksLikeImageEditRequest, buildConversationBody, readChatGptSseEvents, delayWithAbort, fetchConversationDetail, pollForFinalAssistantAnswer };
