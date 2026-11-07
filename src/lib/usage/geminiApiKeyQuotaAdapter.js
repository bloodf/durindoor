/** Gemini inference keys have no documented account snapshot API. Custom URLs
 * are deliberately unsupported here: an operator URL is not official evidence.
 */
export async function fetchGeminiApiKeyQuota() {
  return {
    outcome: "unknown",
    sourceId: "gemini:api-key-quota:v1",
    reasonCode: "missing",
    rows: [],
    quotas: {},
    message: "Gemini API-key account quota is unknown. View project quota in Google AI Studio."
  };
}
