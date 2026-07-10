import fs from "node:fs";
import path from "node:path";

/**
 * Build-time application state is always redirected under a disposable root.
 * This prevents page collection from opening or migrating the operator's real
 * DurinDoor database even when a module unexpectedly reads persistent state.
 */
export function createIsolatedBuildEnvironment(baseEnv, buildRoot) {
  const home = path.join(buildRoot, "home");
  const dataDir = path.join(buildRoot, "data");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  for (const dir of [home, dataDir, appData, localAppData]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return {
    ...baseEnv,
    DURINDOOR_BUILD: "1",
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    DATA_DIR: dataDir,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
