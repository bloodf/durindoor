/** Sanitize a Kilo device-initiation failure without exposing the response body. */
export function kilocodeDeviceInitiationError(status) {
  if (status === 429) return new Error("Too many pending authorization requests. Please try again later.");
  return new Error(`Device auth initiation failed (HTTP ${Number.isInteger(status) ? status : "unknown"}).`);
}
