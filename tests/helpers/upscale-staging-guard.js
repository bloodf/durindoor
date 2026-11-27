// Classify literal git-grep matches without exempting any production directory.
const PREFIX = "open-sse/services/providerParity/native-syntx-media/";
const NEEDLE = "native-image-upscale";
// JavaScript also ends a line at these. The private files do not use them.
const UNUSUAL_LINE_BREAK = /\r(?!\n)|[\u2028\u2029]/;
const BLANK_OR_LINE_COMMENT = /^\s*(?:\/\/.*)?$/;

// A line starting with "//" may sit inside a template, string or block comment.
// Without a lexer, comment context is certain only in the leading header, where
// every line from the start of the file is blank or a line comment. Nothing
// there can open another context. Later matches are ambiguous, as is any file
// with an unusual line break: no exemption.
function hasReferenceAfterCommentHeader(content) {
  if (UNUSUAL_LINE_BREAK.test(content)) return true;
  const lines = content.split(/\r?\n/);
  const headerEnd = lines.findIndex((line) => !BLANK_OR_LINE_COMMENT.test(line));
  return headerEnd !== -1 && lines.slice(headerEnd).some((line) => line.includes(NEEDLE));
}

export function isForbiddenUpscaleReference(path, content) {
  if (!content.includes(NEEDLE)) return false;
  if (path === `${PREFIX}config.js` || path === `${PREFIX}index.js`) {
    return hasReferenceAfterCommentHeader(content);
  }
  if (path !== `${PREFIX}registration.json`) return true;
  try {
    const data = JSON.parse(content);
    const ownership = data.modalities.upscale;
    if (Object.keys(ownership).sort().join(",") !== "owner,requiredExports,sourceFlow,status" ||
        ownership.status !== "owned-by-native-image-upscale" ||
        ownership.owner !== "native-image-upscale private framework unit") return true;
    const lines = content.split(/\r?\n/).filter((line) => line.includes(NEEDLE));
    return lines.length !== 2 ||
      lines[0] !== '      "status": "owned-by-native-image-upscale",' ||
      lines[1] !== '      "owner": "native-image-upscale private framework unit",';
  } catch {
    return true;
  }
}
