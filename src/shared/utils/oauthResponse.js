/** Parse OAuth responses, including text returned by proxies on HTTP errors. */
export async function parseOAuthResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) ?? {};
  } catch {
    return response.ok ? {} : { error: text.trim() };
  }
}

export function oauthResponseError(response, data) {
  const detail = data?.errorDescription || data?.error || data?.message;
  const message = String(detail?.message || detail || "").trim();
  return message || `Authentication failed (${response.status})`;
}
