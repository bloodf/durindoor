// Downloaded artifact checks for the staged Firefly web UI flow (#2034).
// The type comes from the file's own magic bytes, never from a file name,
// a page-provided MIME type or a URL.
import fs from "node:fs";
import path from "node:path";

const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V "]);

const ascii = (bytes, start, end) => bytes.subarray(start, end).toString("latin1");

/** `{ mime, format }` when `bytes` are a supported `kind` artifact, else null. */
export function detectArtifact(kind, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (kind === "image") {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", format: "png" };
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", format: "jpeg" };
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mime: "image/webp", format: "webp" };
    return null;
  }
  if (kind === "video") {
    if (ascii(bytes, 4, 8) === "ftyp" && MP4_BRANDS.has(ascii(bytes, 8, 12))) return { mime: "video/mp4", format: "mp4" };
    if (bytes.readUInt32BE(0) === 0x1a45dfa3 && ascii(bytes, 0, Math.min(bytes.length, 64)).includes("webm")) return { mime: "video/webm", format: "webm" };
    return null;
  }
  return null;
}

/**
 * Read an owned downloaded file within `maxBytes`. Null when it is missing,
 * not a regular file, a symlink, empty or too large.
 */
export function readOwnedArtifact(file, ownedDir, maxBytes) {
  if (path.dirname(file) !== ownedDir) return null;
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes) return null;
  const bytes = fs.readFileSync(file);
  return bytes.length === stat.size && bytes.length <= maxBytes ? bytes : null;
}
