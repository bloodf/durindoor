import { NextResponse } from "next/server";
import { clearTraces, listTraces } from "@/lib/db/repos/proxyTimelineRepo.js";

const FILTER_KEYS = [
  "provider",
  "model",
  "connectionId",
  "apiKeyId",
  "status",
  "endpoint",
  "startDate",
  "endDate",
  "q",
];

/**
 * GET /api/timeline — paginated sidecar traces.
 * Query names are the camelCase spec names only (`connection` is ignored).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPage = searchParams.get("page");
    const page = rawPage === null ? 1 : Number(rawPage);
    const rawPageSize = searchParams.get("pageSize");
    const pageSize = rawPageSize === null ? 20 : Number(rawPageSize);

    if (!Number.isInteger(page) || page < 1) {
      return NextResponse.json({ error: "page must be an integer >= 1" }, { status: 400 });
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "pageSize must be an integer in [1,100]" }, { status: 400 });
    }

    const filter = { page, pageSize };
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value != null) filter[key] = value;
    }
    return NextResponse.json(await listTraces(filter));
  } catch (error) {
    console.error("[API] Failed to list timeline traces:", error);
    return NextResponse.json({ error: "Failed to list timeline traces" }, { status: 500 });
  }
}

/** DELETE /api/timeline — wipe sidecar traces. */
export async function DELETE() {
  try {
    await clearTraces();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear timeline traces:", error);
    return NextResponse.json({ error: "Failed to clear timeline traces" }, { status: 500 });
  }
}
