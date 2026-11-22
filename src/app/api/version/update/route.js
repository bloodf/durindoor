import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { normalizeTargetVersion, formatUpdaterPackageSpec } from "@/shared/utils/updaterVersion";

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

  // Schedule detached updater then exit current server process.
  // Pin @latest (registry tip, matches installCmdLatest) unless a valid version was selected.
  spawnUpdaterAndExit(formatUpdaterPackageSpec(UPDATER_CONFIG.npmPackageName, targetVersion));

  return NextResponse.json({
    success: true,
    message: "Updater started. This app will exit shortly.",
    version: targetVersion || "latest",
    statusUrl: `http://127.0.0.1:${UPDATER_CONFIG.statusPort}/update/status`,
  });
}
