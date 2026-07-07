import { FORMATS } from "../translator/formats.js";
import { transformAnthropicMessages } from "pxpipe-proxy/transform";

// Compress Claude-format request bodies to context-images via pxpipe-proxy.
// Fail-open: any error or ineligibility returns null and leaves the body untouched.
export async function compressWithPxpipe(body, { enabled, model, format, diagnostics = null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "compress_disabled");
    return null;
  }
  if (format !== FORMATS.CLAUDE) {
    setDiagnostic(diagnostics, "unsupported_format");
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setDiagnostic(diagnostics, "parse_error");
    return null;
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const res = await transformAnthropicMessages({ body: encoded, model });

    if (res.applied) {
      const next = JSON.parse(new TextDecoder().decode(res.body));
      for (const key of Object.keys(body)) {
        delete body[key];
      }
      Object.assign(body, next);
      return { applied: true, reason: res.reason, info: res.info };
    }

    setDiagnostic(diagnostics, res.reason);
    return null;
  } catch (e) {
    setDiagnostic(diagnostics, "transform_error");
    return null;
  }
}

export function formatPxpipeLog(stats) {
  if (!stats || !stats.info) return null;
  const { origChars, compressedChars, imageCount } = stats.info;
  if (origChars === undefined || compressedChars === undefined) return null;
  return `${origChars}→${compressedChars} chars, ${imageCount ?? 0} image(s)`;
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}
