export const WEBSESSION_FETCH_TIMEOUT_MS = 30_000;

export function mergeAbortSignals(...signals) {
  const live = signals.filter(Boolean);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);

  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason);
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function withTimeoutSignal(signal, timeoutMs = WEBSESSION_FETCH_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? mergeAbortSignals(signal, timeoutSignal) : timeoutSignal;
}

export function stripCookieInputPrefix(value = "") {
  return String(value || "")
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/^Cookie:\s*/i, "")
    .trim();
}

export function extractCookieValue(cookieHeader = "", name) {
  const raw = stripCookieInputPrefix(cookieHeader);
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? match[1] : "";
}

export function normalizeSessionCookieHeader(value = "", defaultCookieName) {
  const raw = stripCookieInputPrefix(value);
  if (!raw) return "";
  if (raw.includes("=")) return raw;
  return `${defaultCookieName}=${raw}`;
}

export function normalizeSessionCookieHeaders(values = [], defaultCookieName) {
  return values
    .map((value) => normalizeSessionCookieHeader(value, defaultCookieName))
    .filter(Boolean);
}

export function sanitizeErrorMessage(value = "") {
  return String(value || "")
    .replace(/(Bearer|token|cookie|api[_-]?key)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(/([?&](?:key|token|auth|cookie)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 2000);
}

export async function readTextStream(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export function extractTextFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
}

export function estimateTokens(text = "") {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorJson(status, message, type = "upstream_error", extra = {}) {
  return jsonResponse({ error: { message: sanitizeErrorMessage(message), type, ...extra } }, status);
}

export function mergeUpstreamExtraHeaders(headers, extraHeaders) {
  if (!extraHeaders || typeof extraHeaders !== "object") return headers;
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (typeof value === "string" && value.trim()) headers[key] = value;
  }
  return headers;
}
