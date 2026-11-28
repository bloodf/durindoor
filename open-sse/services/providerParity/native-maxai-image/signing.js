// MaxAI credential triple and per-request signer for the staged image adapter.
//
// Signing is a port of OmniRoute c71f0065 open-sse/executors/maxai/signing.ts
// (buildMaxaiSignedHeaders / computeMaxaiProof / maxaiAesEncrypt). It is the
// same algorithm the local chat executor (open-sse/executors/maxai.js
// signedHeaders) uses; that helper is module-private, so registration should
// export one shared signer instead of keeping both (see registration.json).
//
// Credential selection delegates to the existing account-tuple resolver.
import { createCipheriv, createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { resolveMaxaiCredential } from "../../../executors/maxaiCredentials.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { MAXAI_WEBAPP_PAGE } from "./config.js";

const CLIENT_DOMAIN = "maxai.co";
const MAGIC = Buffer.from("Salted__", "ascii");
const HEX_KEY_RE = /^[0-9a-f]{40,}$/;
const CTX_KEY_RE = /^[0-9a-f]{40}$/;
const APP_VERSION_RE = /^webpage_\d+\.\d+\.\d+$/;

/** Source MAXAI_DEFAULT_HEADER_NAMES. */
export const MAXAI_HEADER_NAMES = Object.freeze({
  authorization: "X-Authorization",
  browserName: "X-Browser-Name",
  browserVersion: "X-Browser-Version",
  browserMajor: "X-Browser-Major",
  appVersionHeader: "X-App-Version",
  appEnvHeader: "X-App-Env",
  appEnvValue: "MaxAI-Browser-Extension",
});

/** Source maxaiStaticHeaders(): the Firefox-150 identity sent on every MaxAI request. */
export function maxaiStaticHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    Accept: "*/*",
    "Accept-Language": "en-CA,en;q=0.9",
    Origin: "https://www.maxai.co",
    Referer: "https://www.maxai.co/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Content-Type": "application/json",
  };
}

/**
 * Resolve one complete account tuple with the chat/session resolver; never fill
 * missing cookie members from saved fields. Keep the image adapter's legacy
 * LocalStorage device-ID quote stripping without mutating stored credentials.
 * No credentials or signing state are cached here.
 */
export function resolveMaxaiImageCredential(credentials) {
  const data = credentials?.providerSpecificData;
  const normalized = isRecord(data) ? { ...data } : null;
  if (normalized) {
    for (const key of ["maxaiDeviceId", "deviceId"]) {
      if (isString(normalized[key])) normalized[key] = normalized[key].trim().replace(/^"|"$/g, "");
    }
  }
  const auth = resolveMaxaiCredential(normalized ? { ...credentials, providerSpecificData: normalized } : credentials);
  return auth.ok ? { token: auth.token, deviceId: auth.deviceId, userId: auth.userId } : null;
}

/** Whether a constants record is complete and well formed (source isValidConstantsShape, minus docIdKey). */
export function isUsableMaxaiConstants(value) {
  return isRecord(value) && HEX_KEY_RE.test(value.hmacKey ?? "") && HEX_KEY_RE.test(value.aesKey ?? "")
    && APP_VERSION_RE.test(value.appVersion ?? "") && CTX_KEY_RE.test(value.ctxKey ?? "");
}

function evpBytesToKey(passphrase, salt) {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  const pass = Buffer.from(passphrase, "utf8");
  while (derived.length < 48) {
    block = createHash("md5").update(Buffer.concat([block, pass, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

/** CryptoJS.AES.encrypt(text, passphrase).toString(): base64("Salted__" + salt + AES-256-CBC). */
export function maxaiAesEncrypt(plaintext, passphrase, salt = randomBytes(8)) {
  const { key, iv } = evpBytesToKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([MAGIC, salt, cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]).toString("base64");
}

/** Source computeMaxaiProof for a non-/oauth path. */
export function computeMaxaiProof(path, reqTime, userId, hmacKey, appVersion) {
  const signStr = `${appVersion}:${reqTime}:${path}:${userId}`;
  const sha1 = createHmac("sha1", Buffer.from(`${reqTime}:${hmacKey}`, "utf8")).update(signStr, "utf8").digest("hex");
  return createHash("sm3").update(`${reqTime}:${sha1}:${hmacKey}`, "utf8").digest("hex");
}

/**
 * Source buildMaxaiSignedHeaders: the X-Authorization blob plus its X-App and
 * X-Browser companions. `now`, `random` and `salt` are test seams.
 */
export function buildMaxaiSignedHeaders({ path, userId, deviceId, now = Date.now, random, salt }, constants) {
  const reqTime = now();
  const slot = random ? random() : String(randomInt(100000, 1000000));
  // Key order is part of the signed JSON string.
  const payload = {
    "X-Client-Domain": CLIENT_DOMAIN,
    "X-Client-Path": MAXAI_WEBAPP_PAGE,
    "X-Random": slot,
    t: reqTime,
    p: computeMaxaiProof(path, reqTime, userId, constants.hmacKey, constants.appVersion),
    d: deviceId,
    [constants.ctxKey]: { a: "" },
  };
  const h = MAXAI_HEADER_NAMES;
  return {
    [h.browserName]: "Firefox",
    [h.browserVersion]: "150.0",
    [h.browserMajor]: "150",
    [h.appVersionHeader]: constants.appVersion,
    [h.appEnvHeader]: h.appEnvValue,
    [h.authorization]: maxaiAesEncrypt(JSON.stringify(payload), constants.aesKey, salt),
  };
}
