import { createHmac, randomBytes } from "node:crypto";
import { isString } from "../../../shared/utils/typeChecks.js";
import { getMetaSync } from "./metaStore.js";

/** Installation-scoped, non-secret usage identifier; callers pass raw credentials. */
export function fingerprintApiKey(key, salt) {
  return isString(key) && key ? `hmac-sha256:${createHmac("sha256", salt).update(key).digest("hex")}` : null;
}

export function getOrCreateUsageIdentitySalt(db) {
  const existing = getMetaSync(db, "usageIdentitySalt");
  if (existing) return existing;
  db.run("INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING", ["usageIdentitySalt", randomBytes(32).toString("hex")]);
  return getMetaSync(db, "usageIdentitySalt");
}
