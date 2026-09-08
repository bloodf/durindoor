import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { canModifySecurityCriticalSettings } from "@/lib/settings/settingsPatchAuth";
import {
  DATA_RETENTION_PRESET_DAYS,
  getDataRetentionLastRun,
  normalizeRetentionDays,
  runDataRetention,
} from "@/lib/dataRetention/runner.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    enabled: settings.dataRetentionEnabled === true,
    days: normalizeRetentionDays(settings.dataRetentionDays) ?? 30,
    presets: DATA_RETENTION_PRESET_DAYS,
    lastRun: await getDataRetentionLastRun(),
  });
}

/** Run the sweep now with the saved retention window, or an explicit `days`. */
export async function POST(request) {
  if (!(await canModifySecurityCriticalSettings(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const settings = await getSettings();
  const days = normalizeRetentionDays(body?.days ?? settings.dataRetentionDays);
  if (days === null) {
    return NextResponse.json({ error: "Invalid days" }, { status: 400 });
  }
  try {
    const result = await runDataRetention({ days, trigger: "manual" });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[data-retention] manual run failed:", error);
    return NextResponse.json({ error: "Retention run failed" }, { status: 500 });
  }
}
