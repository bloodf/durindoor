import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, open, link, unlink } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";
import { isString } from "../../shared/utils/typeChecks.js";
import { getBillingEpoch } from "@/lib/db/repos/usageRepo.js";

function ownerDir() { return path.join(getDataDir(), "native-resource-owners"); }

function fileFor(provider, connectionId, resourceId, billingEpoch = null) {
  const identity = billingEpoch === null ? `${provider}\0${connectionId}\0${resourceId}` : JSON.stringify([billingEpoch, provider, connectionId, resourceId]);
  return path.join(ownerDir(), createHash("sha256").update(identity).digest("hex") + ".json");
}

/** Look up ownership by provider account and exact resource ID; missing records fail closed. */
export async function readNativeResourceOwner(provider, connectionId, resourceId) {
  try {
    const billingEpoch = await getBillingEpoch();
    const file = fileFor(provider, connectionId, resourceId, billingEpoch);
    const owner = JSON.parse(await readFile(file, "utf8"));
    if (!owner?.ownerId || owner.provider !== provider || owner.connectionId !== connectionId || owner.resourceId !== resourceId) return null;
    // Files survive database imports. Never upgrade an old owner's generation.
    if ((owner.billingEpoch ?? null) !== billingEpoch || billingEpoch !== await getBillingEpoch()) return null;
    // Legacy files belong only to the pre-cutover generation; make null explicit.
    owner.billingEpoch ??= null;
    if (!owner.usageEventId) {
      // Legacy native accounting used this exact provider/account/operation ID.
      // Preserve it across polls and restarts rather than minting a new charge.
      // Ambiguous legacy delimiters cannot safely establish ledger identity.
      if (![provider, connectionId, resourceId].every((value) => value != null && isString(value) && value && !value.includes(":"))) return null;
      owner.usageEventId = `${provider}:${connectionId}:${resourceId}:terminal`;
      await writeFile(file, JSON.stringify(owner), { encoding: "utf8", mode: 0o600 });
    }
    if (owner.usageEventId == null || !isString(owner.usageEventId) || !owner.usageEventId.trim()) return null;
    return owner;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Persist the creator before releasing a successful creation response.
 * Keep records after delete/cancel: these operations never transfer ownership,
 * and an upstream retry must not let another gateway key claim the same ID.
 *
 * Writes through a same-directory temp file, fsyncs the payload, then publishes
 * with link (create-once). When link is unavailable (ENOTSUP/EPERM), fall back
 * to an exclusive create on the target. An existing owner is kept and the call
 * returns quietly (first writer wins); other errors are rethrown. Never rename
 * over the target.
 */
export async function createNativeResourceOwner(owner) {
  if (!owner?.resourceId || !owner?.ownerId) return;
  // Stamps come from dispatch, never from this delayed creation callback.
  const billingEpoch = owner.billingEpoch ?? null;
  if (billingEpoch !== await getBillingEpoch()) throw new Error("Stale or missing billing epoch");
  const record = { ...owner, billingEpoch };
  // Inner scope keeps first-writer-wins early returns ahead of the post-write epoch fence.
  await (async () => {
    const dir = ownerDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = fileFor(owner.provider, owner.connectionId, owner.resourceId, billingEpoch);
    const tmp = path.join(
      dir,
      `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
    );
    let handle;
    try {
      handle = await open(tmp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await link(tmp, target);
      } catch (error) {
        if (error?.code === "EEXIST") return;
        if (error?.code === "ENOTSUP" || error?.code === "EPERM") {
          // Fail closed: exclusive create never replaces an existing owner.
          // EEXIST matches the link path: first writer wins; return quietly.
          // A concurrent reader of a partial claim hits non-ENOENT JSON parse.
          let claim;
          try {
            claim = await open(target, "wx", 0o600);
            await claim.writeFile(JSON.stringify(record), "utf8");
            await claim.sync();
            await claim.close();
            claim = undefined;
          } catch (fallbackError) {
            if (fallbackError?.code === "EEXIST") return;
            if (claim !== undefined) {
              try { await claim.close(); } catch { /* ignore close during cleanup */ }
              try { await unlink(target); } catch { /* ignore partial claim cleanup */ }
            }
            throw fallbackError;
          }
          return;
        }
        throw error;
      }
    } finally {
      if (handle !== undefined) {
        try { await handle.close(); } catch { /* ignore close failure during cleanup */ }
      }
      try { await unlink(tmp); } catch { /* ignore missing/raced temp cleanup */ }
    }
  })();
  // Import can commit during filesystem I/O; any stale file remains unreadable.
  if (billingEpoch !== await getBillingEpoch()) throw new Error("Stale or missing billing epoch");
}
