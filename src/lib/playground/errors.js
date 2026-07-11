// Sanitizes server error text before it reaches the playground UI so markup,
// stack frames, and absolute filesystem paths never render in a toast or
// message bubble. Capped at 200 chars so a runaway trace can't flood the UI.
function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function sanitizeErrorText(value) {
  let text = textValue(value);
  if (!text) return "";
  text = text.replace(/<[^>]*>/g, " ");
  text = text
    .split("\n")
    .filter((line) => !/^\s*at\s+/.test(line))
    .join(" ");
  text = text.replace(/[A-Za-z]:(?!\/\/)[\\/][^\s)]+/g, "");
  text = text.replace(/(?:^|\s)\/(?!\/)[^\s)]*/g, "");
  text = text.replace(/([[\("'=:\s])\/(?!\/)[^\s)\]"']*/g, "$1");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 200) text = `${text.slice(0, 199).trimEnd()}…`;
  return text;
}
