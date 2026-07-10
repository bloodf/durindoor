import { NextResponse } from "next/server";
import { killAppProcesses, scheduleIntentionalHandoffExit } from "@/lib/appUpdater";

// Shutdown app to release file locks for manual update
export async function POST() {
  try {
    await killAppProcesses();
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `Shutdown blocked because safe process cleanup failed: ${error.message}`,
    }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  scheduleIntentionalHandoffExit(500);

  return response;
}
