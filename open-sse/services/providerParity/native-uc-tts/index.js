// Staged, unregistered UC (uncensored.com) native text-to-speech adapter
// (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createUcTtsAdapter } from "./tts.js";

export * from "./config.js";
export { cookieHeader, normalizeCookieJar, resolveUcCredential, ucSecrets, uidFromSessionJwt } from "./credentials.js";
export { mintUcSessionToken, ucMintHeaders, ucMintUrl } from "./clerk.js";
export { __setUcTtsWebSocketForTesting, buildUcTtsStartFrame, buildUcTtsWsUrl, runUcTtsSocket } from "./socket.js";
export { buildUcSpeechInput, createUcTtsAdapter, isMp3, ucAcceptedJob } from "./tts.js";

/** Default instance: TTS_ADAPTERS under `uc`. */
export const ucTtsAdapter = createUcTtsAdapter();
