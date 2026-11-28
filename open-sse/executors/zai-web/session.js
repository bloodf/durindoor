/**
 * Proof extraction ported from OmniRoute (MIT, Copyright (c) 2026 Cheaper
 * Inference, Diego Souza), protocol.ts blob 511e5d3aa9937ef537712b8163ad6b997878a9f7
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878 (also b15b2ee6).
 * Proof is opaque: the source defines neither a TTL nor a challenge verifier.
 * Never cache, synthesize, refresh, or retry a supplied proof here.
 */
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
function json(value) {
  try { return typeof value === "string" && value.trim().startsWith("{") ? record(JSON.parse(value)) : null; }
  catch { return null; }
}
export function extractZaiCaptchaVerifyParam(value) {
  const obj = record(value);
  if (obj) {
    const direct = obj.captcha_verify_param ?? obj.captchaVerifyParam ?? obj.zaiCaptchaVerifyParam;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    return obj.providerSpecificData ? extractZaiCaptchaVerifyParam(obj.providerSpecificData) : "";
  }
  if (typeof value !== "string") return "";
  const parsed = json(value);
  if (parsed) return extractZaiCaptchaVerifyParam(parsed);
  return value.match(/(?:^|;\s*)captcha_verify_param=([^;]+)/)?.[1]?.trim() ?? "";
}
export function resolveZaiCaptchaVerifyParam(credentials, body) {
  return extractZaiCaptchaVerifyParam(body) || extractZaiCaptchaVerifyParam(credentials.providerSpecificData) ||
    extractZaiCaptchaVerifyParam(credentials.apiKey) || extractZaiCaptchaVerifyParam(credentials.accessToken);
}

/**
 * Private canonical import field: providerSpecificData.token, copied from the
 * fixed origin's Local Storage item `token`. Shared import stores named items
 * under their original keys. Legacy apiKey/accessToken remain supported, but
 * multiple different sessions or malformed explicit storage fail closed.
 * The caller must pass only the selected account's credentials; no global cache.
 */
export function resolveZaiWebSession(credentials = {}, extract) {
  credentials ??= {};
  const psd = record(credentials.providerSpecificData);
  const values = [];
  if (psd && Object.hasOwn(psd, "token")) {
    if (typeof psd.token !== "string" || !psd.token.trim() || /[\s;=]/.test(psd.token.trim())) return "";
    values.push(psd.token.trim());
  }
  for (const value of [credentials.apiKey, credentials.accessToken]) {
    if (value == null || value === "") continue;
    const parsed = json(value);
    const token = parsed ? parsed.token ?? parsed.accessToken ?? parsed.access_token : value;
    const extracted = extract(token);
    if (!extracted) return "";
    values.push(extracted);
  }
  return values.length && values.every((value) => value === values[0]) ? values[0] : "";
}

/** Audit copies must not retain an opaque proof supplied in the request body. */
export function redactZaiProof(value) {
  if (!record(value)) return value;
  const copy = { ...value };
  for (const key of ["captcha_verify_param", "captchaVerifyParam", "zaiCaptchaVerifyParam"]) {
    if (Object.hasOwn(copy, key)) copy[key] = "[REDACTED]";
  }
  if (record(copy.providerSpecificData)) copy.providerSpecificData = redactZaiProof(copy.providerSpecificData);
  return copy;
}
