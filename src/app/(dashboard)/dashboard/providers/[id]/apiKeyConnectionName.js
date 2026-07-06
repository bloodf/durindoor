export function defaultApiKeyConnectionName(existingConnectionCount = 0) {
  const count = Number(existingConnectionCount);
  return Number.isFinite(count) && count > 0 ? `main-${Math.floor(count) + 1}` : "main";
}
