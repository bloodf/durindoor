/** Convert untrusted provider test text into a bounded, secret-safe explanation. */
export function classifyProviderDiagnostic(value, { unavailable = false, skipped = false } = {}) {
  if (skipped) return { category: "unsupported", title: "Test not supported", guidance: "This connection cannot be checked with the standard test. Try a small request with a model you expect to work." };
  if (unavailable) return { category: "runtime", title: "Provider unavailable", guidance: "The provider or network did not complete the check. Try again later." };
  const text = String(value ?? "").slice(0, 2000).toLowerCase();
  if (/\b(401|403|unauthorized|forbidden|invalid[_ -]?(api[_ -]?)?key|invalid[_ -]?grant|token expired|authentication|credentials?)\b/.test(text)) {
    const safeLabel = /credentials? rejected/.test(text) ? "Credentials rejected" : /invalid[_ -]?(api[_ -]?)?key/.test(text) ? "Invalid API key" : "Authentication problem";
    return { category: "auth", title: "Authentication problem", safeLabel, guidance: "Check the saved key, token, or account authorization. Reconnect if the credential has expired or been revoked." };
  }
  if (/\b(402|429|quota|rate.?limit|billing|insufficient[_ -]?(quota|credit)|resource_exhausted)\b/.test(text)) {
    return { category: "quota", title: "Quota or rate limit", guidance: "Check provider usage, billing, and reset time, then retry." };
  }
  if (/\b(404|405|501|unsupported|not supported|unknown model|model not found|no such model)\b/.test(text)) {
    return { category: "unsupported", title: "Unsupported model or check", guidance: "Confirm the model ID and that this provider supports the connection test." };
  }
  return { category: "runtime", title: "Connection check failed", guidance: "Check provider availability and network or proxy settings, then retry." };
}
