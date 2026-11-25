import { createHash } from "crypto";
import { isString } from "../../src/shared/utils/typeChecks.js";

/** Allocate Kiro-safe names once per request, preserving a reversible map. */
export function createKiroToolNames(names, nameMap) {
  const assigned = new Map();
  const used = new Set(names.filter((name) => isString(name) && name.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(name)));

  return (original) => {
    if (!isString(original)) return original;
    if (assigned.has(original)) return assigned.get(original);
    const safe = original.replace(/[^a-zA-Z0-9_-]/g, "_");
    let name = safe;
    if (safe.length > 64 || (safe !== original && used.has(safe))) {
      let salt = 0;
      do {
        const hash = createHash("sha256").update(original + (salt ? `:${salt}` : "")).digest("hex").slice(0, 12);
        name = `${safe.slice(0, 51)}_${hash}`;
        salt++;
      } while (used.has(name));
    }
    used.add(name);
    assigned.set(original, name);
    if (name !== original) nameMap.set(name, original);
    return name;
  };
}
