// Field-level AES-256-GCM encryption for credential columns (SEC-B-02).
//
// A single master key lives at <DATA_DIR>/master-key (mode 0o600, 32 random
// bytes). It is lazily read (or minted) on first use and cached on the module.
// The master key is NEVER logged, NEVER exported, NEVER included in db dumps.
//
// Wire format per encrypted field:
//   { v: 1, iv: <base64 12B>, ct: <base64 ciphertext+tag> }
// Callers supply the row id as Additional Authenticated Data so a ciphertext
// cannot be replayed into a different row.
//
// Implementation note: uses Node's synchronous `crypto.createCipheriv` /
// `createDecipheriv` (AES-256-GCM). The synchronous API is required because
// the DB layer wraps writes in better-sqlite3's synchronous transaction
// primitive; an async cipher would force us to split the CAS + lock + write
// out of the transaction and break OAuth refresh-token atomicity.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "@/lib/dataDir";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

const MASTER_KEY_BASENAME = "master-key";
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

let cachedKey = null;

function loadMasterKey() {
  if (cachedKey) return cachedKey;
  if (!isString(process.env.DATA_DIR) || !process.env.DATA_DIR) {
    throw new Error("columnCrypto: DATA_DIR required to load master key");
  }
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, MASTER_KEY_BASENAME);
  let raw = null;
  try {
    raw = fs.readFileSync(keyPath);
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }
  if (raw && raw.length === MASTER_KEY_BYTES) {
    cachedKey = raw;
    return cachedKey;
  }
  if (raw && raw.length > 0) {
    throw new Error(
      `columnCrypto: ${MASTER_KEY_BASENAME} must be exactly ${MASTER_KEY_BYTES} bytes`
    );
  }
  const generated = crypto.randomBytes(MASTER_KEY_BYTES);
  fs.writeFileSync(keyPath, generated, { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

function encodeAad(aad) {
  if (aad == null) return null;
  return Buffer.from(String(aad), "utf8");
}

/**
 * Encrypt a UTF-8 plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @param {string|number|null} aad - Additional Authenticated Data (e.g. row id).
 * @returns {{v:number, iv:string, ct:string}}
 */
export function encryptField(plaintext, aad = null) {
  if (!isString(plaintext)) {
    throw new TypeError("columnCrypto.encryptField: plaintext must be a string");
  }
  const key = loadMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES
  });
  const aadBuf = encodeAad(aad);
  if (aadBuf) cipher.setAAD(aadBuf);
  const ciphertext = Buffer.concat([
  cipher.update(plaintext, "utf8"),
  cipher.final()]
  );
  const tag = cipher.getAuthTag();
  // Pack ct+tag so the blob is self-contained.
  const packed = Buffer.concat([ciphertext, tag]);
  return {
    v: FORMAT_VERSION,
    iv: iv.toString("base64"),
    ct: packed.toString("base64")
  };
}

/**
 * Decrypt a blob previously produced by encryptField.
 * Throws on tampered ciphertext, wrong AAD, or unsupported shape.
 * @param {{v:number, iv:string, ct:string}} blob
 * @param {string|number|null} aad - Same AAD used at encryption time.
 * @returns {string}
 */
export function decryptField(blob, aad = null) {
  if (!blob || !isObject(blob)) {
    throw new TypeError("columnCrypto.decryptField: blob must be an object");
  }
  if (blob.v !== FORMAT_VERSION) {
    throw new Error(`columnCrypto: unsupported blob version ${blob.v}`);
  }
  if (!isString(blob.iv) || !isString(blob.ct)) {
    throw new Error("columnCrypto: blob missing iv/ct");
  }
  const key = loadMasterKey();
  const iv = Buffer.from(blob.iv, "base64");
  const packed = Buffer.from(blob.ct, "base64");
  if (packed.length < TAG_BYTES) {
    throw new Error("columnCrypto: ciphertext too short");
  }
  const ciphertext = packed.subarray(0, packed.length - TAG_BYTES);
  const tag = packed.subarray(packed.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES
  });
  const aadBuf = encodeAad(aad);
  if (aadBuf) decipher.setAAD(aadBuf);
  decipher.setAuthTag(tag);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("columnCrypto: authentication failed (tampered or wrong AAD)");
  }
  return plain.toString("utf8");
}

/** Return true if `value` looks like an encrypted blob from encryptField. */
export function isEncryptedBlob(value) {
  return (
    !!value && isObject(
      value) &&
    value.v === FORMAT_VERSION && isString(
      value.iv) && isString(
      value.ct));

}

/** Test-only: clear cached key material so the next call re-reads disk. */
export function __resetColumnCryptoForTests() {
  cachedKey = null;
}