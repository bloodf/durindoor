import fs from "fs/promises";
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
    throw new Error(`${filePath} exists but could not be parsed; refusing to overwrite it`);
  }
}
