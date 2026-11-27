// Grok CLI (Grok Build) native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`grok-cli`: id "grok-cli", alias "gc",
// baseUrl `${GROK_BUILD_PROXY_BASE_URL}/videos`, statusUrl
// `${GROK_BUILD_PROXY_BASE_URL}/videos`, authType "oauth", authHeader "bearer",
// format "xai-video", model grok-imagine-video), with GROK_BUILD_PROXY_BASE_URL
// = https://cli-chat-proxy.grok.com/v1 from open-sse/config/grokBuildEndpoints.ts.
// Wire behavior comes from open-sse/handlers/videoGeneration.ts (format
// dispatch), open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts (create
// + poll) and open-sse/handlers/grokMedia.ts (getGrokMediaToken,
// grokMediaHeaders): `POST {baseUrl}/generations` answers `{ request_id }`, then
// `GET {statusUrl}/{request_id}` answers `{ status, video: { url } }` with
// status "done" | "failed" | other (pending).
//
// The existing local `grok-cli` provider (open-sse/providers/registry/grok-cli.js,
// alias `gb`, aliases `gcli`/`grok-build`, OAuth device code only) is reused.
// The source alias `gc` is NOT adopted: locally `gc` belongs to Gemini CLI.
// API-key xAI video stays on the separate `xai` provider (videoConfig
// https://api.x.ai/v1/videos through open-sse/handlers/videoCore.js); this
// adapter never reads `apiKey`.
import { GROK_CLI_SHELL_USER_AGENT, GROK_CLI_VERSION } from "../../../config/grokCli.js";

export const GROK_CLI_PROVIDER_ID = "grok-cli";
/** Local aliases of the existing registry entry. The source alias `gc` is Gemini CLI here. */
export const GROK_CLI_ALIASES = Object.freeze(["gb", "gcli", "grok-build"]);
export const GROK_CLI_SOURCE_ALIAS = "gc";
/** The only origin the OAuth token is sent to. Connection base URLs are ignored. */
export const GROK_CLI_ORIGIN = "https://cli-chat-proxy.grok.com";
export const GROK_CLI_PROXY_BASE_URL = `${GROK_CLI_ORIGIN}/v1`;
export const GROK_CLI_VIDEOS_URL = `${GROK_CLI_PROXY_BASE_URL}/videos`;
export const GROK_CLI_VIDEO_GENERATIONS_URL = `${GROK_CLI_VIDEOS_URL}/generations`;
export const GROK_CLI_VIDEO_FORMAT = "xai-video";
export const GROK_CLI_AUTH_TYPE = "oauth";

// Source grokMediaHeaders(): getGrokBuildClientHeaders("headless") plus the
// token-auth marker and the Bearer token. The client version and User-Agent are
// the fork's pinned Grok CLI identity (open-sse/config/grokCli.js), because the
// proxy rejects older identities with 426; the source default was 1.0.41.
export const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_CLIENT_MODE = "headless";
export const GROK_CLI_CLIENT_VERSION = GROK_CLI_VERSION;
export const GROK_CLI_USER_AGENT = GROK_CLI_SHELL_USER_AGENT;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** The source's static list. No dynamic video discovery exists in the source. */
export const GROK_CLI_VIDEO_MODELS = freezeAll([
  { id: "grok-imagine-video", name: "Grok Imagine Video (OAuth)", kind: "video" },
]);

export const grokCliVideoModel = (id) => GROK_CLI_VIDEO_MODELS.find((model) => model.id === id) ?? null;
export const grokCliVideoStatusUrl = (requestId) => `${GROK_CLI_VIDEOS_URL}/${encodeURIComponent(requestId)}`;

// Source bounds (xaiGrokImagineHandler.ts): 300 s default job deadline, 30 min
// ceiling, 2.5 s poll interval with a 1 s floor, at most 300 polls. Out-of-range
// caller knobs are a 400 there and here.
export const GROK_CLI_JOB_TIMEOUT_MS = 300_000;
export const GROK_CLI_MAX_JOB_TIMEOUT_MS = 30 * 60_000;
export const GROK_CLI_POLL_INTERVAL_MS = 2_500;
export const GROK_CLI_MIN_POLL_INTERVAL_MS = 1_000;
export const GROK_CLI_MAX_POLLS = 300;
// Gateway bounds for each submit and each status request.
export const GROK_CLI_SUBMIT_TIMEOUT_MS = 60_000;
export const GROK_CLI_REQUEST_TIMEOUT_MS = 30_000;
export const GROK_CLI_MAX_POLL_RETRIES = 5;
export const GROK_CLI_MAX_RETRY_DELAY_MS = 30_000;
/** Source MAX_RESPONSE_BYTES. */
export const GROK_CLI_MAX_RESPONSE_BYTES = 1024 * 1024;
