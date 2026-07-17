import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import {
  validateFirecrawlBaseUrl,
  validateFirecrawlApiKey,
  validateFirecrawlHeaders,
  probeFirecrawlEndpoint,
  probeDefaultFirecrawlEndpoints,
  upsertFirecrawlCustomConnection,
  ALLOWED_FIRECRAWL_HOSTS,
} from "@/lib/firecrawl/firecrawlConfig";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

async function canAccessDetectRoute() {
  const settings = await getSettings();
  if (settings.requireLogin === false) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

export async function POST(request) {
  try {
    if (!(await canAccessDetectRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "manual" ? "manual" : "auto";

    const apiKeyValidation = validateFirecrawlApiKey(body.apiKey);
    if (!apiKeyValidation.ok) {
      return NextResponse.json({ error: apiKeyValidation.error }, { status: 400, headers: HEADERS });
    }

    const headerValidation = validateFirecrawlHeaders(body.headers);
    if (!headerValidation.ok) {
      return NextResponse.json({ error: headerValidation.error }, { status: 400, headers: HEADERS });
    }

    let probe;
    let baseUrl;
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";

    if (rawUrl) {
      const urlValidation = validateFirecrawlBaseUrl(rawUrl);
      if (!urlValidation.ok) {
        return NextResponse.json(
          { error: urlValidation.error, allowedHosts: ALLOWED_FIRECRAWL_HOSTS },
          { status: 400, headers: HEADERS }
        );
      }
      const url = urlValidation.url;
      baseUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
      probe = await probeFirecrawlEndpoint(baseUrl, {
        apiKey: apiKeyValidation.apiKey,
        headers: headerValidation.headers,
      });
    } else if (mode === "auto") {
      const defaultProbe = await probeDefaultFirecrawlEndpoints({
        apiKey: apiKeyValidation.apiKey,
        headers: headerValidation.headers,
      });
      baseUrl = defaultProbe.baseUrl || "http://127.0.0.1:3002";
      probe = defaultProbe;
    } else {
      return NextResponse.json({ error: "Firecrawl base URL is required" }, { status: 400, headers: HEADERS });
    }

    if (mode === "auto" && !probe.ok) {
      return NextResponse.json(
        { ok: false, baseUrl, detected: false, error: probe.error },
        { status: 503, headers: HEADERS }
      );
    }

    const connection = await upsertFirecrawlCustomConnection({
      baseUrl,
      apiKey: apiKeyValidation.apiKey,
      headers: headerValidation.headers,
      isActive: probe.ok,
      testStatus: probe.ok ? "active" : "pending",
    });

    return NextResponse.json({
      ok: probe.ok,
      baseUrl,
      detected: probe.ok,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        isActive: connection.isActive,
        providerSpecificData: connection.providerSpecificData,
      },
      error: probe.ok ? undefined : probe.error,
    }, { status: probe.ok ? 200 : 202, headers: HEADERS });
  } catch (error) {
    console.error("Error detecting Firecrawl", { name: error?.name, code: error?.code });
    return NextResponse.json({ error: "Firecrawl detection failed" }, { status: 500 });
  }
}
