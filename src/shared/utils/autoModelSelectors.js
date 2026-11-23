import { isString } from "@/shared/utils/typeChecks.js";
/** Advertise only selectors implemented by the chat and media handlers. */
export function addAutoModelSelectors(models, kind) {
  if (!models.some((m) => m?.owned_by !== "combo" && isString(m?.id) && m.id.includes("/"))) return models;
  const suffix = kind === "llm" ? "" : kind === "image" || kind === "video" ? `:${kind}` : null;
  if (suffix === null) return models;
  const existing = new Set(models.map((m) => m.id));
  const selectors = ["auto", "best", "fast", "cheap"].map((name) => `${name}${suffix}`)
    .filter((id) => !existing.has(id)).map((id) => ({ id, object: "model", owned_by: "durindoor", kind }));
  return [...selectors, ...models];
}
