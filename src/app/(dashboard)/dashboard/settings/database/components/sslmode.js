export const SSL_MODES = ["disable", "require", "verify-full"];

/** Legacy prefer/allow settings must not silently opt out of encryption. */
export function normalizeSslmode(value) {
  return SSL_MODES.includes(value) ? value : "require";
}
