/**
 * Per-provider token refresh capabilities. Providers without a row have none.
 *
 *   - rotationGroup: providers sharing a group refresh one at a time
 *     (see ../refreshSerializer.js).
 *   - googleAntiBurst: the background scheduler spaces these accounts further apart.
 *   - googleProjectId: the account carries a Google Cloud project ID.
 */
const GOOGLE_CLOUD = Object.freeze({ googleAntiBurst: true, googleProjectId: true });
const lane = (rotationGroup) => Object.freeze({ rotationGroup });

const REFRESH_CAPABILITIES = Object.freeze({
  antigravity: GOOGLE_CLOUD,
  agy: GOOGLE_CLOUD,
  "gemini-cli": GOOGLE_CLOUD,
  codex: lane("openai-auth0"),
  openai: lane("openai-auth0"),
  claude: lane("anthropic-oauth"),
  "gitlab-duo": lane("gitlab-duo"),
  kiro: lane("kiro"),
  "amazon-q": lane("kiro"),
  "kimi-coding": lane("kimi-coding"),
  "kimi-ai": lane("kimi-ai"),
  qwen: lane("qwen")
});

const NO_CAPABILITIES = Object.freeze({});

export function refreshCapabilities(provider) {
  return Object.hasOwn(REFRESH_CAPABILITIES, provider) ? REFRESH_CAPABILITIES[provider] : NO_CAPABILITIES;
}
