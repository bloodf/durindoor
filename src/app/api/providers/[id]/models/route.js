import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { fetchConnectionModels } from "./fetchConnectionModels.js";

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await fetchConnectionModels(connection, { requestUrl: request.url, signal: request.signal });
    if (result.error) {
      // A provider that classifies its probe outcome reports it, so a caller
      // can tell an auth rejection from a transient upstream failure.
      return NextResponse.json({
        error: result.error,
        ...(result.classification ? { classification: result.classification } : null)
      }, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const safeMessage = sanitizeErrorMessage(error?.message || "Internal server error");
    console.error("Error fetching provider models:", safeMessage);
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
