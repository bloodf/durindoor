// Classify literal git-grep matches without exempting any production directory.
const PREFIX = "open-sse/services/providerParity/native-syntx-media/";
const NEEDLE = "native-image-upscale";

export function isForbiddenUpscaleReference(path, content) {
  if (!content.includes(NEEDLE)) return false;
  if (path === `${PREFIX}config.js` || path === `${PREFIX}index.js`) {
    return content.split(/\r?\n/).some((line) => line.includes(NEEDLE) && !/^\s*\/\/[^\r\n]*native-image-upscale[^\r\n]*$/.test(line));
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
