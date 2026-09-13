// Generated media and retrieval payloads for the example cards: a real PNG
// (gradient, uncompressed deflate), a silent WAV, deterministic embedding
// vectors, and plausible web search / fetch results.

import { seeded } from "./world.js";

// ---- bytes helpers ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

function chunk(type, payload) {
  const typed = [...type].map((char) => char.charCodeAt(0));
  const body = Uint8Array.from([...typed, ...payload]);
  return [...u32(payload.length), ...body, ...u32(crc32(body))];
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// ---- PNG --------------------------------------------------------------------

/** A size x size RGB PNG: a prompt-seeded diagonal gradient with a soft sun. */
export function gradientPng(prompt = "", size = 96) {
  const rand = seeded(hashString(prompt));
  const from = [rand() * 255, rand() * 255, rand() * 255];
  const to = [rand() * 255, rand() * 255, rand() * 255];
  const sun = { x: size * (0.3 + rand() * 0.4), y: size * (0.25 + rand() * 0.3), r: size * 0.18 };
  const raw = new Uint8Array(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (2 * size);
      const glow = Math.max(0, 1 - Math.hypot(x - sun.x, y - sun.y) / sun.r);
      for (let c = 0; c < 3; c += 1) raw[offset++] = Math.min(255, from[c] + (to[c] - from[c]) * t + glow * 140);
    }
  }
  // One stored deflate block (raw is < 65535 bytes for size <= 147).
  const len = raw.length;
  const zlib = [0x78, 0x01, 0x01, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255, ...raw, ...u32(adler32(raw))];
  const header = [...u32(size), ...u32(size), 8, 2, 0, 0, 0];
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", header), ...chunk("IDAT", zlib), ...chunk("IEND", [])]);
}

// ---- WAV --------------------------------------------------------------------

/** Silent 16-bit mono PCM WAV of the given length. */
export function silentWav(seconds = 0.6, sampleRate = 8000) {
  const samples = Math.round(seconds * sampleRate);
  const dataSize = samples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

// ---- embeddings -------------------------------------------------------------

export function embeddingVector(text, dimensions = 768) {
  const rand = seeded(hashString(text));
  const raw = Array.from({ length: dimensions }, () => rand() * 2 - 1);
  const norm = Math.hypot(...raw) || 1;
  return raw.map((value) => Number((value / norm).toFixed(8)));
}

export function relevance(query, document) {
  const words = new Set(String(query).toLowerCase().split(/\W+/).filter(Boolean));
  const hits = String(document).toLowerCase().split(/\W+/).filter((word) => words.has(word)).length;
  return Number(Math.min(0.99, 0.12 + hits * 0.21 + (hashString(document) % 100) / 1000).toFixed(4));
}

// ---- web search / fetch -----------------------------------------------------

const SEARCH_SOURCES = [
  { host: "news.ycombinator.com", title: "Show HN: routing every coding agent through one local gateway" },
  { host: "arstechnica.com", title: "Model providers race to cut long-context pricing" },
  { host: "github.blog", title: "What's new for coding agents this month" },
  { host: "simonwillison.net", title: "Notes on running multiple LLM subscriptions side by side" },
  { host: "theverge.com", title: "The week in AI: new frontier models and quota changes" },
  { host: "developers.googleblog.com", title: "Gemini API: streaming and function calling updates" },
  { host: "anthropic.com", title: "Claude release notes" },
  { host: "openai.com", title: "Responses API changelog" },
];

export function searchResults(query, max = 5, provider = "tavily") {
  const retrievedAt = new Date().toISOString();
  return SEARCH_SOURCES.slice(0, Math.max(1, Math.min(Number(max) || 5, SEARCH_SOURCES.length))).map((source, index) => {
    const slug = String(query || "ai").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return {
      title: source.title,
      url: `https://${source.host}/${slug || "article"}-${index + 1}`,
      display_url: source.host,
      snippet: `${source.title}. Coverage related to "${query}", with context on pricing, rate limits and how teams are combining providers.`,
      score: Number((0.95 - index * 0.07).toFixed(2)),
      published_at: new Date(Date.now() - (index + 1) * 86_400_000 * 1.7).toISOString(),
      favicon_url: null,
      content: null,
      metadata: { author: null, language: "en", source_type: "web", image_url: null },
      citation: { provider, retrieved_at: retrievedAt, rank: index + 1 },
      provider_raw: null,
    };
  });
}

export function fetchedPage(url, format = "markdown") {
  let host = "example.com";
  try {
    host = new URL(url).hostname;
  } catch {
    // Keep the default host for malformed input.
  }
  const title = host === "example.com" ? "Example Domain" : `${host} | Home`;
  const markdown = `# ${title}\n\nThis domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.\n\n[More information...](https://www.iana.org/domains/example)`;
  const text = format === "html"
    ? `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>This domain is for use in illustrative examples in documents.</p></body></html>`
    : format === "text"
      ? markdown.replace(/[#[\]]/g, "").replace(/\(https?:[^)]+\)/g, "")
      : markdown;
  return { title, text };
}
