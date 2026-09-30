/** Placeholder text prepended to an image-only user turn bound for Poe. */
export const POE_IMAGE_ONLY_TEXT_PLACEHOLDER = "[Image(s) attached]";

const IMAGE_TYPES = new Set(["image_url", "input_image", "image"]);
const isImagePart = (part) => IMAGE_TYPES.has(part?.type);
const isTextPart = (part) => part?.type === "text";

/**
 * Poe (api.poe.com/v1/chat/completions) answers 400 for a `user` message whose
 * content array holds only image parts. Prepend a text part for provider `poe`
 * only; other providers and already-valid turns keep the same array reference.
 */
export function ensurePoeUserTurnHasText(messages, provider) {
  if (provider !== "poe" || !Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((msg) => {
    if (msg?.role !== "user" || !Array.isArray(msg.content)) return msg;
    const parts = msg.content;
    if (parts.some(isTextPart) || !parts.some(isImagePart)) return msg;
    changed = true;
    return { ...msg, content: [{ type: "text", text: POE_IMAGE_ONLY_TEXT_PLACEHOLDER }, ...parts] };
  });
  return changed ? next : messages;
}
