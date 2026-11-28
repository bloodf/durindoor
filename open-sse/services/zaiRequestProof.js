import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const proofKeys = ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"];
const REDACTED = "[REDACTED]";
const OMIT = Symbol("omit");
// Same boundaries as the Z.ai extractor's cookie form: `(?:^|;\s*)captcha_verify_param=([^;]+)`.
const firstCookieProof = /^()captcha_verify_param=[^;]+$/;
const laterCookieProof = /^(\s*)captcha_verify_param=[^;]+$/;

// Same acceptance as the extractor: a trimmed "{" string that parses to a record.
function parseRecord(value) {
  try {
    if (!value.trim().startsWith("{")) return null;
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch { return null; }
}

function rewriteCookie(value, redact) {
  let changed = false;
  const parts = [];
  value.split(";").forEach((part, index) => {
    const match = part.match(index === 0 ? firstCookieProof : laterCookieProof);
    if (!match) return parts.push(part);
    changed = true;
    if (redact) parts.push(`${match[1]}captcha_verify_param=${REDACTED}`);
  });
  if (!changed) return value;
  const next = parts.join(";").replace(/^\s+/, "");
  return !redact && !next.trim() ? OMIT : next;
}

/** Rewrite one record and, recursively, its accepted providerSpecificData envelope. */
function rewriteRecord(value, redact) {
  const copy = { ...value };
  let changed = false;
  for (const key of proofKeys) {
    if (!Object.hasOwn(copy, key)) continue;
    changed = true;
    if (redact) copy[key] = REDACTED;
    else delete copy[key];
  }
  if (Object.hasOwn(copy, "providerSpecificData")) {
    const next = rewriteEnvelope(copy.providerSpecificData, redact);
    if (next !== copy.providerSpecificData) {
      changed = true;
      if (next === OMIT) delete copy.providerSpecificData;
      else copy.providerSpecificData = next;
    }
  }
  return { copy, changed };
}

/** Accepted PSD shapes: record, serialized JSON record, or canonical cookie string. */
function rewriteEnvelope(value, redact) {
  if (isRecord(value)) {
    const { copy, changed } = rewriteRecord(value, redact);
    if (!changed) return copy;
    return !redact && Object.keys(copy).length === 0 ? OMIT : copy;
  }
  if (!isString(value)) return value;
  const parsed = parseRecord(value);
  if (!parsed) return rewriteCookie(value, redact);
  const { copy, changed } = rewriteRecord(parsed, redact);
  if (!changed) return value;
  return !redact && Object.keys(copy).length === 0 ? OMIT : JSON.stringify(copy);
}

/**
 * Client Z.ai proofs belong only to the selected canonical zai-web provider.
 * Clone the request/PSD path so a later combo member retains its original proof.
 * This is outbound omission, independent of stored credentials and audit redaction.
 * Proof keys/segments are removed (never replaced), and a PSD wrapper emptied by
 * that removal is omitted; unrecognized strings and unrelated data are kept.
 */
export function isolateZaiRequestProof(body, provider) {
  if (provider === "zai-web" || !isRecord(body)) return body;
  return rewriteRecord(body, false).copy;
}

/** Audit copy: replace accepted proof values with a placeholder, keeping shape. */
export function redactZaiRequestProof(value) {
  return isRecord(value) ? rewriteRecord(value, true).copy : value;
}
