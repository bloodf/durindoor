import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";
import { isString } from "../../shared/utils/typeChecks.js";
import { getBillingEpoch } from "@/lib/db/repos/usageRepo.js";

function ownerDir() { return path.join(getDataDir(), "native-resource-owners"); }

function fileFor(provider, connectionId, resourceId, billingEpoch = null) {
  const identity = billingEpoch === null ? `${provider}\0${connectionId}\0${resourceId}` : JSON.stringify([billingEpoch, provider, connectionId, resourceId]);
  return path.join(ownerDir(), createHash("sha256").update(identity).digest("hex") + ".json");
}

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

export async function createNativeResourceOwner(owner) {
  if (!owner?.resourceId || !owner?.ownerId) return;
  // Stamps come from dispatch, never from this delayed creation callback.
  const billingEpoch = owner.billingEpoch ?? null;
  if (billingEpoch !== await getBillingEpoch()) throw new Error("Stale or missing billing epoch");
  await mkdir(ownerDir(), { recursive: true, mode: 0o700 });
  try {
    await writeFile(fileFor(owner.provider, owner.connectionId, owner.resourceId, billingEpoch), JSON.stringify({ ...owner, billingEpoch }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  // Import can commit during filesystem I/O; any stale file remains unreadable.
  if (billingEpoch !== await getBillingEpoch()) throw new Error("Stale or missing billing epoch");
}
