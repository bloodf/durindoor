import { NextResponse } from "next/server";
import { providerReadiness } from "@/shared/services/providerReadiness.js";

// This endpoint reports local configuration only and never makes a provider request.
export async function GET(_request, { params }) {
  const { id } = await params;
  return NextResponse.json(providerReadiness(id), { headers: { "Cache-Control": "no-store" } });
}
