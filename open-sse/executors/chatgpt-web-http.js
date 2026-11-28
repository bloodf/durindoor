/** ChatGPT Web HTTP transport public API. Implementation lives in focused sibling modules. */
// Preserve the entry dependency on the model registry without adding public names.
export {} from "./chatgpt-web/models.js";
export { detectImageResolutionFailure } from "./chatgpt-web/stream.js";
export { __buildImageDownloadHeadersForTesting } from "./chatgpt-web/images.js";
export { ChatGptWebHttpExecutor } from "./chatgpt-web/executor.js";
export { __resetChatGptWebCachesForTesting } from "./chatgpt-web/session.js";
export { __derivePublicBaseUrlForTesting } from "./chatgpt-web/images.js";
export { __waitForImageViaWebSocketForTesting } from "./chatgpt-web/images.js";

import { setChatGptSseReader } from "./chatgpt-web/conversation.js";

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


// Initialize the parser before callers can use the public executor.
setChatGptSseReader(readChatGptSseEvents);

import { sha3_512Hex } from "../utils/sha3-512.js";
import { setChatGptPowSolver } from "./chatgpt-web/session.js";

const POW_YIELD_EVERY = 1000;


function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}


async function solvePow(opts) {
  const cfg = [...opts.config];
  for (let i = 0; i < opts.maxIter; i++) {
    if (i > 0 && i % POW_YIELD_EVERY === 0) await yieldToEventLoop();
    cfg[3] = i;
    const json = JSON.stringify(cfg);
    const b64 = Buffer.from(json).toString("base64");
    // Portable SHA3-512 — pure-JS fallback under Electron/BoringSSL (OmniRoute #5531).
    const hash = sha3_512Hex(opts.seed + b64);
    if (opts.target && hash.slice(0, opts.target.length) <= opts.target) {
      return `${opts.prefix}${b64}`;
    }
  }
  opts.log?.warn?.(
    "CGPT-WEB",
    `PoW (${opts.label}) exhausted ${opts.maxIter} iterations against target=${opts.target || "<empty>"}; submitting unsolved token (Sentinel may reject)`
  );
  const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
  return `${opts.prefix}${b64}`;
}


setChatGptPowSolver(solvePow);
