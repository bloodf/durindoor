import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function writeConfigAtomic(filePath, contents) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
