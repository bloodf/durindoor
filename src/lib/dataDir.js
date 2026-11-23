import { isHosted } from "../shared/utils/deploymentMode.js";
import dataDir from "./updater/dataDir.cjs";

/** Resolve and protect the application data directory, falling back locally when inaccessible. */
export function getDataDir() {
  return dataDir.resolveDataDir(isHosted);
}

export const DATA_DIR = getDataDir();
