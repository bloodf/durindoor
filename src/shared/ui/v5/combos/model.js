/** Human-readable capabilities retain the gateway's exact storage keys. */
export const CAPABILITY_LABELS = {
  vision: "vision", pdf: "PDF reading", audioInput: "audio input", videoInput: "video input",
  imageOutput: "image output", audioOutput: "audio output", videoOutput: "video output",
  search: "web search", tools: "tool calls", reasoning: "reasoning",
};
export function modelCapabilities(caps) {
  return Object.entries(CAPABILITY_LABELS).filter(([key]) => caps?.[key] === true).map(([, label]) => label);
}
export function splitModelIdentity(value, nested = false) {
  const slash = value.indexOf("/");
  return { provider: nested ? "Combo" : slash < 0 ? "Custom" : value.slice(0, slash), model: nested || slash < 0 ? value : value.slice(slash + 1), value };
}

export const CAPABILITY_ICONS = {
  vision: "visibility", pdf: "picture_as_pdf", audioInput: "mic", videoInput: "videocam",
  imageOutput: "image", audioOutput: "volume_up", videoOutput: "movie", search: "travel_explore",
  tools: "build", reasoning: "psychology",
};
export function compactTokenCount(value) {
  if (value >= 1000000) return `${+(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)}k`;
  return String(value);
}
