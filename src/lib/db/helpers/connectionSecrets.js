import { decryptField, encryptField } from "../../crypto/columnCrypto.js";

// Version 1 used only the row id; version 2 binds both row and field.
export function encryptConnectionSecret(value, id, field) {
  return encryptField(value, `conn:${id}:${field}`, 2);
}

export function decryptConnectionSecret(value, id, field) {
  if (value.v !== 1) return decryptField(value, `conn:${id}:${field}`);
  try { return decryptField(value, id); } catch { return decryptField(value); }
}
