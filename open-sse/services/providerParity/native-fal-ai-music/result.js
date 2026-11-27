// fal music result normalization.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/mediaGeneration/fal.ts (normalizeFalMediaResult for
// `music`: `audio.url` is required, the format comes from `content_type`'s
// subtype, else the file name or URL extension, else `wav`; a result without a
// URL is a 502).
//
// Fork deviations: the URL must be https, carry no userinfo, and name a public
// host (src/shared/utils/ssrfGuard.js assertPublicUrl), so a result never
// points a caller at a private address; a non-audio content type is refused.
// The response uses the local music shape (`object: "music.generation"`,
// `audio_url`) and also keeps the source's `url` and `format`. The source's
// native `output`/`artifacts` passthrough is not returned: only the track and
// its seed are.
import { assertPublicUrl } from "../../../../src/shared/utils/ssrfGuard.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_MUSIC_PROVIDER_ID } from "./config.js";

const FORMAT_RE = /^[a-z0-9][a-z0-9.+-]{0,31}$/;

function safeAudioUrl(value) {
  if (!isString(value) || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    assertPublicUrl(url.toString());
    return url.toString();
  } catch {
    return null;
  }
}

function formatOf(item, url) {
  const contentType = isString(item.content_type) ? item.content_type.toLowerCase().split(";")[0].trim() : "";
  if (contentType.includes("/")) {
    const subtype = contentType.split("/", 2)[1];
    return FORMAT_RE.test(subtype) ? subtype : null;
  }
  const name = isString(item.file_name) ? item.file_name : new URL(url).pathname;
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension && FORMAT_RE.test(extension) ? extension : "wav";
}

/**
 * The public music response for one fal result, or `{ error }` when the result
 * has no usable track.
 */
export function normalizeFalMusicResult(output, { model, requestId, created }) {
  const item = isRecord(output?.audio) ? output.audio : null;
  if (!item) return { error: "fal music result has no audio" };
  const url = safeAudioUrl(item.url);
  if (!url) return { error: "fal music result has no usable audio URL" };
  if (isString(item.content_type) && !/^audio\//i.test(item.content_type.trim())) return { error: "fal music result is not audio" };
  const format = formatOf(item, url);
  if (!format) return { error: "fal music result has an unreadable content type" };
  const track = { id: requestId, audio_url: url, url, format };
  if (isString(item.content_type)) track.content_type = item.content_type.trim().toLowerCase();
  if (isString(item.file_name) && item.file_name.length <= 256) track.file_name = item.file_name;
  if (Number.isInteger(item.file_size) && item.file_size >= 0) track.file_size = item.file_size;
  if (Number.isInteger(output.seed)) track.seed = output.seed;
  return {
    payload: {
      object: "music.generation",
      provider: FAL_MUSIC_PROVIDER_ID,
      model,
      status: "completed",
      created: isNumber(created) ? created : Math.floor(Date.now() / 1000),
      data: [track],
    },
  };
}
