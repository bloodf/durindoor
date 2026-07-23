import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";

// GET /api/keys/[id]/reveal — return the full API-key secret for re-copying.
//
// The list/detail views intentionally mask the secret; this dedicated route is
// the on-demand path the dashboard uses to reveal-and-copy an existing key, so
// the raw value is not dumped into every list response. Auth is enforced by the
// dashboard guard (session JWT / CLI token / API key) before this handler runs.
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const record = await getApiKeyById(id);
    if (!record) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: record.key });
  } catch (error) {
    console.log("Error revealing key:", error);
    return NextResponse.json({ error: "Failed to reveal key" }, { status: 500 });
  }
}
