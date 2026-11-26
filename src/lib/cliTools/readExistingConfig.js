import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { redactSecrets } from "@/shared/utils/secretRedaction";

/**
 * Read and parse a CLI tool config before a merge that writes back to the same path.
 * Parser failures log only safe metadata because engine messages may quote raw file bytes.
 * Read and parse failures must stop the write without exposing those messages to clients.
 *
 * @param {string} filePath
 * @param {(raw: string) => unknown} parse
 * @returns {Promise<unknown|null>} Parsed contents, or null when the file is absent.
 */
export async function readExistingConfig(filePath, parse) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  try {
    return parse(raw);
  } catch (error) {
    console.log("Error parsing existing CLI config:", redactSecrets({
      filePath,
      parserError: {
        name: error?.name || "Error",
        code: error?.code || null,
      },
    }));
    const failure = new Error(`${filePath} exists but could not be parsed; refusing to overwrite it`);
    failure.code = "CLI_CONFIG_PARSE_ERROR";
    throw failure;
  }
}

/**
 * A temp-file-and-rename write makes the writer the new owner. Over a file that belongs
 * to another uid (a container user over a bind-mounted host config) that locks the
 * owner out, so refuse before anything is written.
 */
export async function assertWriterOwnsTarget(filePath) {
  const writerUid = process.geteuid?.();
  if (writerUid === undefined) return;
  let existing;
  try {
    existing = await fs.lstat?.(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!Number.isInteger(existing?.uid) || existing.uid === writerUid) return;
  const refusal = new Error(`Refusing to replace CLI config owned by uid ${existing.uid} from uid ${writerUid}: ${filePath}`);
  refusal.code = "CLI_CONFIG_FOREIGN_OWNER";
  throw refusal;
}

/** Atomically replace the resolved config target, retaining one private backup beside it.
 * @returns {Promise<string>} The target path written, for transaction rollback.
 */
export async function writeConfigAtomic(filePath, content) {
  // realpath follows existing links; readlink also handles a missing link target.
  const seen = new Set();
  while (true) {
    try {
      filePath = await fs.realpath(filePath);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      let target;
      try {
        target = await fs.readlink(filePath);
      } catch (linkError) {
        if (linkError?.code === "ENOENT" || linkError?.code === "EINVAL") break;
        throw linkError;
      }
      const resolved = path.resolve(path.dirname(filePath), target);
      if (seen.has(resolved)) {
        const cycle = new Error(`Symlink cycle resolving CLI config: ${filePath}`);
        cycle.code = "ELOOP";
        throw cycle;
      }
      seen.add(resolved);
      filePath = resolved;
    }
  }
  await assertWriterOwnsTarget(filePath);
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const backupTemp = `${tempPath}.bak`;
  try {
    await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    try {
      await fs.copyFile(filePath, backupTemp);
      await fs.chmod(backupTemp, 0o600);
      await fs.rename(backupTemp, `${filePath}.bak`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.rename(tempPath, filePath);
    return filePath;
  } catch (error) {
    // The temp names only need cleanup when a write/backup/rename failed. A
    // successful rename has already consumed them and should not require unlink.
    try { await fs.unlink?.(tempPath); } catch { /* best-effort failure cleanup */ }
    try { await fs.unlink?.(backupTemp); } catch { /* best-effort failure cleanup */ }
    throw error;
  }
}
