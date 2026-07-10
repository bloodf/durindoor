import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stopMitmForUpdate } from "@/lib/appUpdater";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, message: "Not allowed in production" }, { status: 403 });
  }

  const secret = process.env.SHUTDOWN_SECRET;
  const authorization = headers().get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    await stopMitmForUpdate();
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: `Shutdown blocked because MITM cleanup failed: ${error.message}`,
    }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });
  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}
