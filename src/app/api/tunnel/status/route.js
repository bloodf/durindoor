import { NextResponse } from "next/server";
import { getTunnelStatus, getTailscaleStatus, getDownloadStatus } from "@/lib/tunnel";

// A hung tunnel or Tailscale probe must not hold the Endpoint page's first load open (decolua/9router#3852).
const STATUS_PROBE_TIMEOUT_MS = 10000;

function withDeadline(promise) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Tunnel status timed out")), STATUS_PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function GET() {
  try {
    const [tunnel, tailscale] = await withDeadline(Promise.all([getTunnelStatus(), getTailscaleStatus()]));
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel, tailscale, download });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
