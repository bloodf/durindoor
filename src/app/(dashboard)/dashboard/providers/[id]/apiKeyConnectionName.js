export function defaultApiKeyConnectionName(existingConnectionNames = []) {
  if (!Array.isArray(existingConnectionNames)) {
    const count = Number(existingConnectionNames);
    return Number.isFinite(count) && count > 0 ? `main-${Math.floor(count) + 1}` : "main";
  }

  const names = new Set(existingConnectionNames.map((name) => String(name || "").trim()).filter(Boolean));
  if (!names.has("main")) return "main";

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `main-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function shouldResetAddApiKeyModal(previousIsOpen, nextIsOpen) {
  return !previousIsOpen && nextIsOpen;
}
