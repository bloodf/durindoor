import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";

function ownerDir() { return path.join(getDataDir(), "native-resource-owners"); }

function fileFor(provider, connectionId, resourceId) {
  return path.join(ownerDir(), createHash("sha256").update(`${provider}\0${connectionId}\0${resourceId}`).digest("hex") + ".json");
}

export async function readNativeResourceOwner(provider, connectionId, resourceId) {
  try { return JSON.parse(await readFile(fileFor(provider, connectionId, resourceId), "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function createNativeResourceOwner(owner) {
  if (!owner?.resourceId || !owner?.ownerId) return;
  await mkdir(ownerDir(), { recursive: true, mode: 0o700 });
  try {
    await writeFile(fileFor(owner.provider, owner.connectionId, owner.resourceId), JSON.stringify(owner), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}
