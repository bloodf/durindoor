// Staged, unregistered UC (uncensored.com) consumer email sign-in and scoped
// Clerk session controllers (#1241, #2034). Nothing in production imports
// this module; ./registration.json describes the serial wiring step. Source
// attribution is in ./config.js.
export * from "./config.js";
export { clerkErrorCode, clerkResource, parseSetCookies, ucClerkForm, ucClerkHeaders, ucClerkPost, ucClerkUrl } from "./transport.js";
export {
  buildUcConnectionMetadata,
  clampRefreshSkew,
  createUcSessionController,
  expFromSessionJwt,
  mergeCookies,
  mintUcSession,
  sessionJwtClaims,
  ucFailure,
} from "./session.js";
export { createUcSignInController } from "./signin.js";
export { importUcCookies } from "./cookieImport.js";
