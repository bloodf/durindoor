import { NextResponse } from "next/server";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { FILTERS } from "./filters.js";

export const dynamic = "force-dynamic";

// The dashboard sends the registry-declared fetcher back to this endpoint.
// Treat it as an identifier, not an arbitrary server-side URL: accepting an
// unregistered target here would turn this route into an SSRF primitive.
const ALLOWED_FETCHERS = new Set(
  Object.values(AI_PROVIDERS)
    .map((provider) => provider?.modelsFetcher)
    .filter((fetcher) => fetcher && typeof fetcher.url === "string" && typeof fetcher.type === "string")
    .map((fetcher) => `${fetcher.type}\n${fetcher.url}`),
);

export function isAllowedSuggestedModelsFetcher(url, type) {
  return typeof url === "string"
    && typeof type === "string"
    && ALLOWED_FETCHERS.has(`${type}\n${url}`);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  if (!isAllowedSuggestedModelsFetcher(url, type)) {
    return NextResponse.json({ error: "Fetcher is not registered" }, { status: 403 });
  }

  try {
    // Never follow a registry target's redirect to a private/internal host.
    const res = await fetch(url, { redirect: "error" });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
