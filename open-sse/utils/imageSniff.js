// Magic-byte image sniffing, ported from OmniRoute's cursorImages.ts (only the
// format/dimension helpers the ChatGPT Web attachment path needs).

/** Largest edge accepted before a decode is considered a decompression bomb. */
export const MAX_IMAGE_DECODE_EDGE = 8192;

/** Largest pixel count accepted for the same reason. */
export const MAX_IMAGE_PIXELS = 25_000_000;

/** Magic-byte format sniff (independent of declared MIME). */
export function sniffImageFormat(data) {
  if (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "png";
  }
  if (
    data.byteLength >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  ) {
    return "gif";
  }
  if (data.byteLength >= 4 && data[0] === 0xff && data[1] === 0xd8) return "jpeg";
  if (
    data.byteLength >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "webp";
  }
  return undefined;
}

/**
 * Sniff PNG/JPEG/GIF/WebP dimensions from raw bytes when the header is present.
 * Best-effort only — unknown formats return undefined (dimension is optional).
 */
export function sniffImageDimensions(data) {
  // PNG: signature + IHDR chunk (width/height at bytes 16..23)
  if (
    data.byteLength >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    const width = ((data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]) >>> 0;
    const height = ((data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]) >>> 0;
    if (width > 0 && height > 0) return { width, height };
  }
  // GIF: "GIF8" + width/height as little-endian u16 at bytes 6..9
  if (
    data.byteLength >= 10 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  ) {
    const width = data[6] | (data[7] << 8);
    const height = data[8] | (data[9] << 8);
    if (width > 0 && height > 0) return { width, height };
  }
  // WebP: RIFF....WEBP + VP8X / VP8 / VP8L
  if (
    data.byteLength >= 30 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    const fourcc = String.fromCharCode(data[12], data[13], data[14], data[15]);
    if (fourcc === "VP8X") {
      const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
      const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    } else if (fourcc === "VP8 ") {
      if (data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
        const width = (data[26] | (data[27] << 8)) & 0x3fff;
        const height = (data[28] | (data[29] << 8)) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      }
    } else if (fourcc === "VP8L" && data[20] === 0x2f) {
      const raw = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
      const width = (raw & 0x3fff) + 1;
      const height = ((raw >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    }
  }
  // JPEG: scan for SOF0/SOF2 marker with dimensions
  if (data.byteLength >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < data.byteLength) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      // Standalone markers (TEM, RSTn, SOI, EOI) carry no length payload.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = (data[offset + 2] << 8) | data[offset + 3];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = (data[offset + 5] << 8) | data[offset + 6];
        const width = (data[offset + 7] << 8) | data[offset + 8];
        if (width > 0 && height > 0) return { width, height };
        break;
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return undefined;
}
