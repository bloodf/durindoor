import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, open, link, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";

function ownerDir() { return path.join(getDataDir(), "native-resource-owners"); }

function fileFor(provider, connectionId, resourceId) {
  return path.join(ownerDir(), createHash("sha256").update(`${provider}\0${connectionId}\0${resourceId}`).digest("hex") + ".json");
}

/** Look up ownership by provider account and exact resource ID; missing records fail closed. */
export async function readNativeResourceOwner(provider, connectionId, resourceId) {
  try { return JSON.parse(await readFile(fileFor(provider, connectionId, resourceId), "utf8")); } catch (error) {
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
 * with link (create-once) or rename fallback so readers never see a partial
 * record and the first writer wins.
 */
export async function createNativeResourceOwner(owner) {
  if (!owner?.resourceId || !owner?.ownerId) return;
  const dir = ownerDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = fileFor(owner.provider, owner.connectionId, owner.resourceId);
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(tmp, "wx", 0o600);
    await handle.writeFile(JSON.stringify(owner), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      // link is the create-once publish on POSIX; rename would replace an
      // existing owner on Linux and break first-writer-wins.
      await link(tmp, target);
    } catch (error) {
      if (error?.code === "EEXIST") return;
      if (error?.code === "ENOTSUP" || error?.code === "EPERM" || error?.code === "EXDEV") {
        try {
          await rename(tmp, target);
        } catch (renameError) {
          if (renameError?.code === "EEXIST") return;
          throw renameError;
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
}
