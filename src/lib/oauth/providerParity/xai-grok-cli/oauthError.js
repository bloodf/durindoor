import { isRecord, isString } from "../../../../shared/utils/typeChecks.js";

const OAUTH_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Return only a standard-looking OAuth `error` code (for example `invalid_grant`)
 * from a failed token response. Descriptions and non-JSON bodies are dropped so
 * upstream text never reaches logs or user-facing errors.
 */
export async function readOAuthErrorCode(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(text);
    return isRecord(data) && isString(data.error) && OAUTH_ERROR_CODE.test(data.error) ? data.error : null;
  } catch {
    return null;
  }
}

/** Format `<prefix> (HTTP <status>)[: <code>]` without the upstream body. */
export async function oauthFailureMessage(prefix, response) {
  const code = await readOAuthErrorCode(response);
  return `${prefix} (HTTP ${response.status})${code ? `: ${code}` : ""}`;
}
