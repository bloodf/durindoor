import fs from "fs/promises";
import { writeConfigAtomic } from "./readExistingConfig";

async function readIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Track writes to related files so a later failure can undo the earlier ones.
 * This covers a failed write, not a process crash between two writes.
 */
export function createFileTransaction() {
  const applied = [];
  return {
    async write(filePath, content, writer = writeConfigAtomic) {
      const before = await readIfPresent(filePath);
      const writtenPath = await writer(filePath, content);
      applied.push({ filePath: writtenPath || filePath, before, content });
    },
    /** Undo newest first. A file another writer has changed since is left alone. */
    async rollback() {
      for (const { filePath, before, content } of applied.splice(0).reverse()) {
        try {
          if (await readIfPresent(filePath) !== content) continue;
          if (before === null) await fs.unlink(filePath);
          else await writeConfigAtomic(filePath, before);
        } catch (error) {
          // Keep undoing the rest; the caller reports the original failure.
          console.log("Could not restore CLI config:", filePath, error?.code || error?.name);
        }
      }
    },
  };
}
