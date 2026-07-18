import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import {
  probeDefaultFirecrawlEndpoints,
  upsertFirecrawlCustomConnection,
} from "@/lib/firecrawl/firecrawlConfig.js";
import { runAutoConfigure, getAutoConfigureStatus } from "@/lib/autoConfigure/index.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function canAccessAutoConfigureRoute() {
  const settings = await getSettings();
  if (settings.requireLogin === false) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

export async function GET() {
  try {
    if (!(await canAccessAutoConfigureRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getSettings();
    const status = await getAutoConfigureStatus(settings, {
      firecrawl: {
        probe: probeDefaultFirecrawlEndpoints,
        listConnections: async ({ provider }) => {
          const { getProviderConnections } = await import("@/lib/localDb");
          return getProviderConnections({ provider });
        },
      },
    });
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    console.error("[auto-configure] GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await canAccessAutoConfigureRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const settings = await getSettings();
    const report = await runAutoConfigure(settings, {
      dryRun,
      firecrawl: {
        probe: probeDefaultFirecrawlEndpoints,
        listConnections: async ({ provider }) => {
          const { getProviderConnections } = await import("@/lib/localDb");
          return getProviderConnections({ provider });
        },
      },
    });

    if (!dryRun && report.changed) {
      await updateSettings(report.updates);
    }

    const firecrawlReport = report.services.firecrawl;
    if (!dryRun && firecrawlReport.connection && firecrawlReport.baseUrl) {
      try {
        await upsertFirecrawlCustomConnection({
          baseUrl: firecrawlReport.baseUrl,
          apiKey: firecrawlReport.connection.apiKey || "",
          headers: firecrawlReport.connection.firecrawlHeaders
            ? JSON.parse(firecrawlReport.connection.firecrawlHeaders)
            : {},
        });
        report.actions.push("upserted firecrawl custom connection");
      } catch (e) {
        report.actions.push(`firecrawl connection upsert skipped: ${e.message || String(e)}`);
      }
    }

    return NextResponse.json({ ok: true, dryRun, changed: report.changed, report });
  } catch (error) {
    console.error("[auto-configure] POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
