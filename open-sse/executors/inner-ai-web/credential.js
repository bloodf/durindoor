import { isExpiredSessionToken } from "../../utils/webSessionExpiry.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { InnerAiWebError, expiredSession } from "./errors.js";

const MAX_CREDENTIAL_LENGTH = 8192;

// `<jwt>`, `<jwt> <email>`, and both with a `token=` prefix (the form the cookie
// import stores). A full multi-cookie header is refused: the pinned contract
// accepts only the token cookie. The email must be safe to send as a header.
const CREDENTIAL = /^(?:token=)?([\w-]+\.[\w-]+\.[\w-]+);?(?:\s+([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+))?$/;
const HEADER_SAFE = /^[\x21-\x7e]{1,256}$/;

const invalidCredential = () => new InnerAiWebError(
  401,
  "Inner.ai Web needs the token cookie from app.innerai.com, optionally followed by a space and the account email",
  "authentication_error",
  "invalid_credential",
);

function jwtPayload(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Read the selected connection's stored session. Only `apiKey` is read (where
 * cookie connections keep their value). Nothing here sends a request, so a
 * malformed or expired value never leaves the gateway.
 */
export function readInnerAiWebCredential(credentials, now = Date.now()) {
  const raw = isString(credentials?.apiKey) ? credentials.apiKey.trim() : "";
  const match = raw.length <= MAX_CREDENTIAL_LENGTH ? CREDENTIAL.exec(raw) : null;
  if (!match) throw invalidCredential();
  const [, token, credentialEmail = ""] = match;
  const payload = jwtPayload(token);
  if (!payload) throw invalidCredential();
  // The signature is not verified; `exp` only avoids a send that must fail.
  if (isExpiredSessionToken(token, now)) throw expiredSession();
  const deviceId = String(payload.device_id ?? payload.deviceId ?? payload["device-id"] ?? payload.did ?? "").trim();
  const subject = isString(payload.sub) && payload.sub.includes("@") && HEADER_SAFE.test(payload.sub) ? payload.sub : "";
  const plan = String(payload.plan ?? payload.tier ?? payload.subscription ?? "").toLowerCase();
  return { token, credentialEmail, subject, plan, deviceId: HEADER_SAFE.test(deviceId) ? deviceId : "" };
}

export function headerSafeEmail(value) {
  const email = isString(value) ? value.trim() : "";
  return email.includes("@") && HEADER_SAFE.test(email) ? email : "";
}
