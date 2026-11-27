// Cookie import for an operator who signed in to uncensored.com in their own
// browser and pastes the values into the authenticated dashboard. Same field
// aliases as OmniRoute c71f0065 open-sse/executors/uc/credentials.ts
// (resolveUcCredential, :110-125). The source saves the pasted values without
// a check; here one session mint (clerkAuth.ts:89-154) must succeed with the
// pasted jar and sid, and its JWT must name neither another uid (`uid` claim,
// credentials.ts:12-15) nor another session (`sid` claim). An absent claim is
// not a refusal: the source's own uid may come only from the paste (credentials.ts:121-122).
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { resolveUcCredential } from "../native-uc-tts/credentials.js";
import { UC_REQUEST_TIMEOUT_MS, isUcConsumerSignInEnabled } from "./config.js";
import { buildUcConnectionMetadata, mintUcSession, ucFailure } from "./session.js";

/**
 * Import pasted UC cookies. Reads only the credential field aliases; an
 * `apiKey` (including a uc-direct `uai_` key) or OAuth token is ignored.
 *   ({ consent, fields }, { fetchImpl, env, now, signal }) -> { ok, providerSpecificData } | failure
 */
export async function importUcCookies(input, { fetchImpl, env = process.env, now = Date.now, signal, timeoutMs = UC_REQUEST_TIMEOUT_MS } = {}) {
  if (!isUcConsumerSignInEnabled(env)) return ucFailure("disabled");
  if (input?.consent !== true) return ucFailure("consent_required");
  if (!isRecord(input?.fields)) return ucFailure("invalid_credential");
  const credential = resolveUcCredential({ providerSpecificData: input.fields });
  if (!credential) return ucFailure("invalid_credential");
  const minted = await mintUcSession(fetchImpl, { sid: credential.sid, cookies: credential.cookies, expectedUid: credential.uid }, { signal, timeoutMs });
  if (!minted.ok) return minted;
  const metadata = buildUcConnectionMetadata({
    clientCookie: minted.cookies.__client ?? credential.clientCookie,
    sid: credential.sid,
    uid: credential.uid,
    cookies: minted.cookies,
    source: "cookie-import",
    now: now(),
  });
  return metadata ? { ok: true, providerSpecificData: metadata } : ucFailure("malformed", { status: 200 });
}
