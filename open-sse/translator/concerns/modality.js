// Strip multimodal content blocks a model cannot read, BEFORE translation.
// Driven by getCapabilitiesForModel: vision/audioInput/videoInput/pdf. Replaces removed
// media with a short text placeholder so messages never become empty.
import { FORMATS } from "../formats.js";

// Placeholder text inserted where a media block was removed.
// Current turn: explain the active model can't read what the user just sent.
import { isString } from "@/shared/utils/typeChecks.js";const PLACEHOLDER_CURRENT = {
  vision: "[image omitted: model has no vision support]",
  audioInput: "[audio omitted: model has no audio support]",
  videoInput: "[video omitted: model has no video support]",
  pdf: "[file omitted: model has no document support]"
};
// Earlier turns: neutral (a combo may route to a different model each turn).
const PLACEHOLDER_PREV = {
  vision: "[Previous image omitted from context.]",
  audioInput: "[Previous audio omitted from context.]",
  videoInput: "[Previous video omitted from context.]",
  pdf: "[Previous file omitted from context.]"
};
const ph = (cap, isLast) => (isLast ? PLACEHOLDER_CURRENT : PLACEHOLDER_PREV)[cap];

// Map gemini inlineData/fileData mime prefix -> capability it requires.
function capForMime(mime) {
  if (!isString(mime)) return null;
  if (mime.startsWith("image/")) return "vision";
  if (mime.startsWith("audio/")) return "audioInput";
  if (mime.startsWith("video/")) return "videoInput";
  if (mime === "application/pdf") return "pdf";
  return null;
}

// OpenAI chat content block -> required capability (null = plain text/other, keep).
function capForOpenAIBlock(block) {
  const t = block?.type;
  if (t === "image_url" || t === "image" || t === "input_image") return "vision";
  if (t === "input_audio" || t === "audio_url") return "audioInput";
  if (t === "video" || t === "video_url" || t === "input_video") return "videoInput";
  if (t === "file" || t === "document" || t === "input_file") return "pdf";
  return null;
}

// Claude content block -> required capability.
function capForClaudeBlock(block) {
  const t = block?.type;
  if (t === "image") return "vision";
  if (t === "document") return "pdf";
  return null;
}

// Filter an array of content blocks; drop unsupported, inject one placeholder per kind.
// isLast = block belongs to the current user turn (picks the explanatory placeholder).
function filterBlocks(blocks, capOf, caps, removed, isLast) {
  const out = [];
  for (const block of blocks) {
    const cap = capOf(block);
    if (cap && caps[cap] === false) {removed.add(cap);continue;}
    out.push(block);
  }
  for (const cap of removed) out.push({ type: "text", text: ph(cap, isLast) });
  return out;
}

function capForAttachment(attachment) {
  const mime = attachment?.contentType || attachment?.mediaType ||
  isString(attachment?.url) && attachment.url.match(/^data:([^;,:]{1,255})/)?.[1];
  const cap = capForMime(mime);
  return cap || (!mime && (attachment?.url || attachment?.data) ? "vision" : null);
}

function replaceUnsupportedDataUris(content, caps, isLast, removed, inlineRemoved) {
  return content.replace(/data:([^;,:]{1,255})(?:;base64)?,[^\s)]+/gi, (uri, mime) => {
    const cap = capForMime(mime.toLowerCase());
    if (!cap || caps[cap] !== false) return uri;
    removed.add(cap);
    inlineRemoved.add(cap);
    return ph(cap, isLast);
  });
}

// OpenAI / OpenAI-compatible chat messages[].content[] and attachment fields.
function stripOpenAI(body, caps) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    const removed = new Set();
    for (const field of [
    ["images", "vision"], ["image", "vision"], ["image_url", "vision"],
    ["audio", "audioInput"], ["audio_url", "audioInput"],
    ["video", "videoInput"], ["video_url", "videoInput"],
    ["file", "pdf"], ["document", "pdf"]])
    {
      if (caps[field[1]] === false && msg[field[0]] != null) {
        delete msg[field[0]];
        removed.add(field[1]);
      }
    }
    for (const name of ["experimental_attachments", "attachments"]) {
      if (!Array.isArray(msg[name])) continue;
      msg[name] = msg[name].filter((attachment) => {
        const cap = capForAttachment(attachment);
        if (!cap || caps[cap] !== false) return true;
        removed.add(cap);
        return false;
      });
    }
    if (isString(msg.content)) {
      const inlineRemoved = new Set();
      msg.content = replaceUnsupportedDataUris(msg.content, caps, i === last, removed, inlineRemoved);
      const placeholders = [...removed].
      filter((cap) => !inlineRemoved.has(cap)).
      map((cap) => ph(cap, i === last)).join(" ");
      if (placeholders) msg.content = msg.content ? `${msg.content} ${placeholders}` : placeholders;
      if (removed.size && !msg.content) msg.content = [...removed].map((cap) => ph(cap, i === last)).join(" ");
      return;
    }
    if (!Array.isArray(msg.content)) return;
    msg.content = filterBlocks(msg.content, capForOpenAIBlock, caps, removed, i === last);
  });
}

// Claude messages[].content[].
function stripClaude(body, caps) {
  if (!Array.isArray(body.messages)) return;
  const last = body.messages.length - 1;
  body.messages.forEach((msg, i) => {
    if (!Array.isArray(msg.content)) return;
    const removed = new Set();
    msg.content = filterBlocks(msg.content, capForClaudeBlock, caps, removed, i === last);
  });
}

// OpenAI Responses input[].content[] (input_image / input_file).
function stripResponses(body, caps) {
  if (!Array.isArray(body.input)) return;
  const last = body.input.length - 1;
  body.input.forEach((item, i) => {
    if (!Array.isArray(item.content)) return;
    const removed = new Set();
    item.content = item.content.filter((b) => {
      const cap = b?.type === "input_image" ? "vision" : b?.type === "input_file" ? "pdf" : null;
      if (cap && caps[cap] === false) {removed.add(cap);return false;}
      return true;
    });
    for (const cap of removed) item.content.push({ type: "input_text", text: ph(cap, i === last) });
  });
}

// Gemini / gemini-cli contents[].parts[] (inlineData / fileData by mime).
function stripGeminiParts(contents, caps) {
  if (!Array.isArray(contents)) return;
  const last = contents.length - 1;
  contents.forEach((c, i) => {
    if (!Array.isArray(c.parts)) return;
    const removed = new Set();
    c.parts = c.parts.filter((p) => {
      const mime = p?.inlineData?.mimeType || p?.fileData?.mimeType;
      const cap = capForMime(mime);
      if (cap && caps[cap] === false) {removed.add(cap);return false;}
      return true;
    });
    for (const cap of removed) c.parts.push({ text: ph(cap, i === last) });
  });
}

/**
 * Remove media blocks the model can't read, in-place on the source-format body.
 * @param {object} body - request body (source format)
 * @param {string} sourceFormat - one of FORMATS
 * @param {object} caps - capabilities from getCapabilitiesForModel
 * @returns {boolean} true if anything was stripped-eligible (cap false for some modality)
 */
export function stripUnsupportedModalities(body, sourceFormat, caps) {
  if (!body || !caps) return false;
  // Fast exit: model supports everything we'd strip.
  if (caps.vision !== false && caps.audioInput !== false && caps.videoInput !== false && caps.pdf !== false) return false;

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      stripOpenAI(body, caps);
      break;
    case FORMATS.CLAUDE:
      stripClaude(body, caps);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      stripResponses(body, caps);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      stripGeminiParts(body.contents, caps);
      break;
    case FORMATS.ANTIGRAVITY:
      stripGeminiParts(body?.request?.contents, caps);
      break;
    default:
      stripOpenAI(body, caps);
  }
  return true;
}