import fs from "fs/promises";

/**
 * Read and parse a CLI tool config before a merge that writes back to the same path.
 * Only a missing file is an empty config; read and parse failures must stop the write.
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
    const reason = error?.message || String(error);
    throw new Error(`${filePath} exists but could not be parsed (${reason}); refusing to overwrite it`);
  }
}
