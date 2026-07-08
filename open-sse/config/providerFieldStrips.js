// Fields that strict upstream gateways may reject by literal name in a 400
// response. BaseExecutor strips one matching top-level request field and retries
// once, preserving compatibility with clients that send harmless extension data.
export const KNOWN_OFFENDING_FIELDS = [
  "reasoning_budget",
  "chat_template",
  "reasoning_content",
  "context_management",
  "client_metadata",
  "thinking",
  "reasoning",
];

export function findOffendingField(errorText = "") {
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
  if (!text) return null;
  return KNOWN_OFFENDING_FIELDS.find((field) => text.includes(field)) || null;
}
