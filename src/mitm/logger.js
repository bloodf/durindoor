const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");
const { LOG_BLACKLIST_URL_PARTS } = require("./config");
const { sanitizeHeaders } = require("./sanitizeHeaders");
const { runtimeTypeName } = require("../shared/utils/typeChecks.cjs");

function time() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg) => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg) => console.error(`[${time()}] ❌ [MITM] ${msg}`);

const DUMP_DIR = path.join(DATA_DIR, "logs", "mitm");

function ensureDumpDir() {
  if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });
  const stat = fs.lstatSync(DUMP_DIR);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe MITM dump directory: ${DUMP_DIR}`);
}

// Clear all files inside DUMP_DIR (called on MITM server start to avoid unbounded growth)
function clearDumpDir() {
  try {
    if (!fs.existsSync(DUMP_DIR)) return;
    const stat = fs.lstatSync(DUMP_DIR);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const f of fs.readdirSync(DUMP_DIR)) {
      try { fs.rmSync(path.join(DUMP_DIR, f), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}


function slugify(s, max = 80) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").substring(0, max);
}

function isBlacklisted(url) {
  if (!url) return false;
  return LOG_BLACKLIST_URL_PARTS.some(part => url.includes(part));
}

function stripUrlContent(url) {
  if (!url) return "";
  try {
    const parsed = new URL(String(url), "https://mitm.invalid");
    return `${parsed.pathname}`;
  } catch {
    return String(url).split(/[?#]/, 1)[0];
  }
}

function bodyMetadata(body, type) {
  const bytes = body == null ? 0 : Buffer.isBuffer(body) || body instanceof Uint8Array
    ? body.byteLength
    : Buffer.byteLength(String(body), "utf8");
  return { redacted: true, present: bytes > 0, type, bytes };
}

function boundedHeaders(headers) {
  return Object.fromEntries(Object.entries(sanitizeHeaders(headers || {})).slice(0, 64).map(([key, value]) => [
    String(key).replace(/[\r\n\0]/g, " ").slice(0, 128),
    String(value ?? "").replace(/[\r\n\0]/g, " ").slice(0, 1024)
  ]));
}

// Save request metadata without intercepted payload content.
function dumpRequest(req, bodyBuffer, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  try {
    ensureDumpDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const url = stripUrlContent(req.url).slice(0, 2048);
    const host = String(req.headers?.host || "").replace(/[\r\n\0]/g, " ").slice(0, 255);
    const slug = slugify(host + url);
    const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.req.json`);
    fs.writeFileSync(file, JSON.stringify({
      method: String(req.method || "").replace(/[^A-Za-z]/g, "").slice(0, 16),
      url,
      host,
      headers: boundedHeaders(req.headers),
      body: bodyMetadata(bodyBuffer, Buffer.isBuffer(bodyBuffer) ? "buffer" : runtimeTypeName(bodyBuffer))
    }, null, 2), { mode: 0o600 });
    return file;
  } catch { return null; }
}

// Count response bytes without buffering, decoding, or decompressing content.
function createResponseDumper(req, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const url = stripUrlContent(req.url).slice(0, 2048);
  const host = String(req.headers?.host || "").replace(/[\r\n\0]/g, " ").slice(0, 255);
  const slug = slugify(host + url);
  const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.res.txt`);
  let status = 0;
  let headers = {};
  let bytes = 0;
  let chunks = 0;
  return {
    writeHeader: (s, h) => { status = Number.isInteger(s) ? s : 0; headers = boundedHeaders(h); },
    writeChunk: (chunk) => {
      if (chunk == null) return;
      bytes += bodyMetadata(chunk, "stream").bytes;
      chunks += 1;
    },
    end: () => {
      try {
        ensureDumpDir();
        fs.writeFileSync(file, JSON.stringify({
          status,
          url,
          headers,
          body: { redacted: true, present: bytes > 0, type: "stream", bytes, chunks }
        }, null, 2), { mode: 0o600 });
      } catch { /* ignore */ }
    },
    file
  };
}

module.exports = { log, err, dumpRequest, createResponseDumper, clearDumpDir };
