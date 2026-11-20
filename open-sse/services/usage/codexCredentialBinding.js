import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

// JWT payloads here are consistency hints, not authenticated identity claims.
// Opaque and claim-light tokens remain usable; the backend validates signatures.
function payload(token) {
  if (!isString(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isRecord(value) ? value : null;
  } catch { return null; }
}

const text = (value) => isString(value) && value.trim() || null;

/** Return a non-sensitive mismatch code, or null when no conflict is evident. */
export function codexCredentialBindingMismatch(accessToken, saved = {}, idToken = null) {
  const access = payload(accessToken);
  if (!access) return null;
  const previous = payload(idToken);
  const auth = access["https://api.openai.com/auth"] || {};
  const priorAuth = previous?.["https://api.openai.com/auth"] || {};
  const user = text(auth.chatgpt_user_id);
  const priorUser = text(priorAuth.chatgpt_user_id);
  const savedUser = text(saved?.chatgptUserId);
  if (user && (priorUser && user !== priorUser || savedUser && user !== savedUser)) return "user_mismatch";
  if (text(access.sub) && text(previous?.sub) && text(access.sub) !== text(previous.sub)) return "user_mismatch";
  const account = text(auth.chatgpt_account_id);
  const workspace = text(saved?.workspaceId);
  if (saved?.workspaceStructure === "personal" && account && workspace && account !== workspace) return "personal_account_mismatch";
  return null;
}
