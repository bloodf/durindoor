import { NextResponse } from "next/server";
import https from "https";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { normalizeTargetVersion, formatUpdaterPackageSpec } from "@/shared/utils/updaterVersion";
import { isString } from "@/shared/utils/typeChecks";

/** Resolve the registry tip so the updater can install the exact version checked. */
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(`https://registry.npmjs.org/${UPDATER_CONFIG.npmPackageName}/latest`, { timeout: 4000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const version = JSON.parse(data).version || null;
          resolve(isString(version) ? version : null);
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

export async function POST(request) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      {
        success: false,
        message:
          "Auto-update only works with a production CLI install (not npm run dev). Use the manual install command instead.",
      },
      { status: 403 }
    );
  }

  let body = {};
  try {
    body = request ? await request.json() : {};
  } catch {
    body = {};
  }
  const targetVersion = normalizeTargetVersion(body?.version);
  if (targetVersion === null) {
    return NextResponse.json({ success: false, message: "Invalid DurinDoor version" }, { status: 400 });
  }

  try {
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `Update blocked because safe process cleanup failed: ${error.message}`,
    }, { status: 500 });
  }

  let latestVersion = null;
  if (!targetVersion) {
    latestVersion = await fetchLatestVersion();
    if (!latestVersion) {
      return NextResponse.json({ success: false, message: "Could not resolve a pinned update version from the registry." }, { status: 502 });
    }
  }
  // Install the selected or checked exact version — never @latest.
  const installVersion = targetVersion || latestVersion;
  spawnUpdaterAndExit(targetVersion
    ? formatUpdaterPackageSpec(UPDATER_CONFIG.npmPackageName, targetVersion)
    : `${UPDATER_CONFIG.npmPackageName}@${latestVersion}`);

  return NextResponse.json({
    success: true,
    message: "Updater started. This app will exit shortly.",
    version: installVersion,
    statusUrl: `http://127.0.0.1:${UPDATER_CONFIG.statusPort}/update/status`,
  });
}
