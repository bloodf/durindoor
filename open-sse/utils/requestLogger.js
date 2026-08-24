// Check if running in Node.js environment (has fs module)
import { isBrowser, isFunction, isObject, isString, isUndefined } from "../../src/shared/utils/typeChecks.js";
const isNode = !isUndefined(globalThis.process) && process.versions?.node && !isBrowser();

// Check if logging is enabled via environment variable (default: false)
const LOGGING_ENABLED = !isUndefined(globalThis.process) && process.env?.ENABLE_REQUEST_LOGS === 'true';

let fs = null;
let path = null;
let LOGS_DIR = null;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(!isUndefined(globalThis.process) && process.cwd ? process.cwd() : ".", "logs");
  } catch {

    // Running in non-Node environment (Worker, Browser, etc.)
  }}

// Format timestamp for folder name: 20251228_143045_123
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}
async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
    }

    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path.join(LOGS_DIR, folderName);

    fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });

    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  }
}

// Write JSON file
function writeJsonFile(sessionPath, filename, data) {
  if (!fs || !sessionPath) return;

  try {
    const filePath = path.join(sessionPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (err) {
    console.log(`[LOG] Failed to write ${filename}:`, err.message);
  }
}

const REDACTED = "[redacted]";
const SESSION_METADATA_PATTERN = "session[-_]?id|chatgpt[-_]?account[-_]?id|prompt[-_]?cache[-_]?key";
const SENSITIVE_HEADER_RE = new RegExp(`(?:authorization|auth|cookie|token|secret|signature|password|credential|(?:^|[-_])key(?:$|[-_])|${SESSION_METADATA_PATTERN})`, "i");
const SENSITIVE_QUERY_RE = new RegExp(`^(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|api[-_]?key|key|auth|authorization|cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig|${SESSION_METADATA_PATTERN})$`, "i");
const SENSITIVE_FIELD_RE = new RegExp(`^(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig|${SESSION_METADATA_PATTERN})$`, "i");

export function maskSensitiveText(value) {
  return String(value ?? "").
  replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").
  replace(
    /("(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|x[-_]?api[-_]?key|api[-_]?key|key|auth|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig|session[-_]?id|chatgpt[-_]?account[-_]?id|prompt[-_]?cache[-_]?key)"\s*:\s*")[^"]*"/gi,
    '$1[redacted]"'
  ).
  replace(/([A-Za-z0-9_-]*(?:auth(?:orization)?|cookie|token|key|secret|signature|password|credential|session[-_]?id|chatgpt[-_]?account[-_]?id|prompt[-_]?cache[-_]?key)[A-Za-z0-9_-]*\s*:\s*)[^\r\n]+/gi, "$1[redacted]").
  replace(
    /((?:[?&;#]\s*|^)(?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|api[-_]?key|key|auth|authorization|cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig|session[-_]?id|chatgpt[-_]?account[-_]?id|prompt[-_]?cache[-_]?key)=)[^&;\s]+/gi,
    "$1[redacted]"
  );
}

/** Recursively redact credential fields and credential-shaped text in logs. */
export function maskSensitiveValue(value, seen = new WeakSet(), depth = 0) {
  if (isString(value)) return maskSensitiveText(value);
  if (value == null || !isObject(value) || depth >= 12) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveValue(entry, seen, depth + 1));
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
  key,
  SENSITIVE_FIELD_RE.test(key) ? REDACTED : maskSensitiveValue(entry, seen, depth + 1)]
  ));
}

/**
 * Redact credentials before writing optional request diagnostics to disk.
 * Header names remain visible for troubleshooting, but their values never do.
 */
export function maskSensitiveHeaders(headers) {
  if (!headers) return {};
  const entries = isFunction(headers.entries) ?
  Array.from(headers.entries()) :
  Object.entries(headers);
  return Object.fromEntries(entries.map(([key, value]) => [
  key,
  SENSITIVE_HEADER_RE.test(String(key)) ? REDACTED : value]
  ));
}

/** Redact credential-bearing query parameters while preserving the target. */
export function maskSensitiveUrl(value) {
  if (value == null) return value;
  const raw = String(value);
  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
    const parsed = new URL(raw, "http://request-log.invalid");
    if (parsed.username) parsed.username = REDACTED;
    if (parsed.password) parsed.password = REDACTED;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_RE.test(key)) parsed.searchParams.set(key, REDACTED);
    }
    if (parsed.hash.includes("=")) {
      const fragment = new URLSearchParams(parsed.hash.slice(1));
      for (const key of Array.from(fragment.keys())) {
        if (SENSITIVE_QUERY_RE.test(key)) fragment.set(key, REDACTED);
      }
      parsed.hash = fragment.toString();
    }
    if (isAbsolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw.replace(
      /([?&#](?:access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|ctoken|token|api[-_]?key|key|auth|authorization|cookie|secret|client[-_]?secret|password|private[-_]?key|signature|sig|session[-_]?id|chatgpt[-_]?account[-_]?id|prompt[-_]?cache[-_]?key)=)[^&#\s]*/gi,
      `$1${REDACTED}`
    );
  }
}

// No-op logger when logging is disabled
function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

/**
 * Create a new log session and return logger functions
 * @param {string} sourceFormat - Source format from client (claude, openai, etc.)
 * @param {string} targetFormat - Target format to provider (antigravity, gemini-cli, etc.)
 * @param {string} model - Model name
 * @returns {Promise<object>} Promise that resolves to logger object with methods to log each stage
 */
export async function createRequestLogger(sourceFormat, targetFormat, model) {
  // Return no-op logger if logging is disabled
  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }

  // Wait for session to be created before returning logger
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);

  return {
    get sessionPath() {return sessionPath;},

    // 1. Log client raw request (before any conversion)
    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint: maskSensitiveUrl(endpoint),
        headers: maskSensitiveHeaders(headers),
        body: maskSensitiveValue(body)
      });
    },

    // 2. Log raw request from client (after initial conversion like responsesApi)
    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body: maskSensitiveValue(body)
      });
    },

    // 3. Log OpenAI intermediate format (source → openai)
    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body: maskSensitiveValue(body)
      });
    },

    // 4. Log target format request (openai → target)
    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url: maskSensitiveUrl(url),
        headers: maskSensitiveHeaders(headers),
        body: maskSensitiveValue(body)
      });
    },

    // 5. Log provider response (for non-streaming or error)
    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: maskSensitiveHeaders(headers),
        body: maskSensitiveValue(body)
      });
    },

    // 5. Append streaming chunk to provider response
    appendProviderChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "5_res_provider.txt");
        fs.appendFileSync(filePath, maskSensitiveText(chunk));
      } catch (err) {

        // Ignore append errors
      }},

    // 6. Append OpenAI intermediate chunks (target → openai)
    appendOpenAIChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "6_res_openai.txt");
        fs.appendFileSync(filePath, maskSensitiveText(chunk));
      } catch (err) {

        // Ignore append errors
      }},

    // 7. Log converted response to client (for non-streaming)
    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body: maskSensitiveValue(body)
      });
    },

    // 7. Append streaming chunk to converted response
    appendConvertedChunk(chunk) {
      if (!fs || !sessionPath) return;
      try {
        const filePath = path.join(sessionPath, "7_res_client.txt");
        fs.appendFileSync(filePath, maskSensitiveText(chunk));
      } catch (err) {

        // Ignore append errors
      }},

    // 6. Log error
    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: maskSensitiveText(error?.message || String(error)),
        stack: error?.stack ? maskSensitiveText(error.stack) : undefined,
        requestBody: maskSensitiveValue(requestBody)
      });
    }
  };
}

// Legacy functions for backward compatibility
export function logRequest() {}
export function logResponse() {}
export function logError(provider, { error, url, model, requestBody }) {
  if (!fs || !LOGS_DIR) return;

  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
    }

    const date = new Date().toISOString().split("T")[0];
    const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);

    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      model,
      url: maskSensitiveUrl(url),
      error: maskSensitiveText(error?.message || String(error)),
      stack: error?.stack ? maskSensitiveText(error.stack) : undefined,
      requestBody: maskSensitiveValue(requestBody)
    };

    fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.log("[LOG] Failed to write error log:", err.message);
  }
}