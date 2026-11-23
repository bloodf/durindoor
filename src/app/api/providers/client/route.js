import { resolveQuotaRoutingFloor } from "open-sse/config/quotaSelection.js";
import { evaluateProviderQuotaPreflight } from "@/shared/services/providerQuotaPreflight.js";
import { rankQuotaConnections } from "@/shared/services/quotaSelection.js";
import { applyQuotaProviderOrder, quotaProviderOrder } from "@/shared/utils/quotaProviderOrder";
import { NextResponse } from "next/server";
import { getProviderConnections, getSettings, listProviderQuotaSnapshots } from "@/lib/localDb";
import { backfillClaudeProfiles, backfillCodexEmails } from "@/lib/oauth/providers";
import { backfillCursorEmails } from "@/lib/oauth/services/cursorLocalStore.js";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { sanitizeProviderConnectionForClient } from "@/lib/providers/sanitizeProviderConnectionForClient.js";
import { isBigInt } from "@/shared/utils/typeChecks.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;



// Kiro's direct import persists authType "api_key" (src/app/api/oauth/kiro/
// api-key/route.js); older rows use "apikey" — accept both spellings.
const API_KEY_AUTH_TYPES = ["apikey", "api_key", "auth_token"];

export function isUsageEligible(connection) {
  // A disabled (isActive:false) api-key/free-tier row must not render a quota
  // card — e.g. a stale cloud "ollama" connection kept only for history. OAuth
  // rows stay eligible even when inactive so the user can still reconnect them.
  if (connection.isActive === false && connection.authType !== "oauth") return false;
  return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) && (
    connection.authType === "oauth" ||
    (API_KEY_AUTH_TYPES.includes(connection.authType) && USAGE_APIKEY_PROVIDERS.includes(connection.provider))
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Numeric database values may arrive as strings or BigInts. Invalid values sort last.
function sortablePriority(value) {
  if (value == null || value === "") return Infinity;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Infinity;
}

function sortConnections(connections, sort) {
  const list = [...connections];

  if (sort === "expiring") {
    const expiry = (connection) => Math.min(...[connection.expiresAt, connection.rateLimitedUntil].map((value) => {
      if (value == null || value === "" || isBigInt(value)) return Infinity;
      const time = new Date(value).getTime();
      return Number.isFinite(time) && time > 0 ? time : Infinity;
    }));
    return list.sort((a, b) => {
      const timeA = expiry(a);
      const timeB = expiry(b);
      if (timeA !== timeB) return timeA - timeB;
      const priorityA = sortablePriority(a.priority);
      const priorityB = sortablePriority(b.priority);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.provider || "").localeCompare(b.provider || "");
    });
  }

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  return list.sort((a, b) => {
    const priorityA = sortablePriority(a.priority);
    const priorityB = sortablePriority(b.priority);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}

// Provider ordering is cosmetic: a settings read failure must not break the
// quota connection listing, so fall back to the default order.
async function readQuotaProviderOrderSetting() {
  try {
    const settings = await getSettings();
    return Array.isArray(settings?.quotaProviderOrder) ? settings.quotaProviderOrder : [];
  } catch (error) {
    console.log("Error reading quota provider order:", error);
    return [];
  }
}

export async function GET(request) {
  try {
    await backfillCodexEmails();
    await backfillCursorEmails();
    // Network-bound (one profile call per connection), unlike the two local
    // backfills above — never block the connection listing on it. Its run-once
    // guard resets on failure so the next request retries.
    void backfillClaudeProfiles();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(new Set(eligibleConnections.map((conn) => conn.provider))).sort();

    const providerFilteredConnections = eligibleConnections.filter((conn) => (
      provider === "all" || conn.provider === provider
    ));

    const accountFilteredConnections = providerFilteredConnections.filter((conn) => {
      if (accountStatus === "active") return conn.isActive ?? true;
      if (accountStatus === "inactive") return !(conn.isActive ?? true);
      return true;
    });

    const savedProviderOrder = await readQuotaProviderOrderSetting();
    const providerOrder = quotaProviderOrder(sortConnections(eligibleConnections, sort), savedProviderOrder);
    const sorted = sortConnections(accountFilteredConnections, sort);
    const sortedConnections = sort === "expiring" ? sorted : applyQuotaProviderOrder(sorted, savedProviderOrder);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = await Promise.all(sortedConnections.slice(offset, offset + pageSize).map(async (connection) => {
      const safe = sanitizeProviderConnectionForClient(connection);
      try {
        const snapshots = await listProviderQuotaSnapshots({ connectionId: connection.id, includeStale: true });
        const config = settings.quotaSelection || {};
        const dimensions = config.connections?.[connection.id]?.dimensions || {};
        safe.quotaWindows = [...new Set(snapshots.map((row) => row.identity.dimensionKey))].map((key) => {
          const floor = resolveQuotaRoutingFloor(config, { connectionId: connection.id, provider: connection.provider, dimensionKey: key });
          const own = dimensions[key];
          return { key, percent: own?.routingFloorEnabled === true ? own.routingFloorRatio * 100 : null, effectivePercent: floor.enabled ? floor.ratio * 100 : null };
        });
        const decision = evaluateProviderQuotaPreflight(snapshots, { connectionId: connection.id, provider: connection.provider, connectionWide: true });
        const ranked = rankQuotaConnections([connection], new Map([[connection.id, decision]]), new Map(), { config });
        safe.quotaPaused = ranked[0]?.quotaDecision?.reasons?.includes("below_routing_floor") === true;
      } catch {
        safe.quotaWindows = [];
        safe.quotaPaused = false;
      }
      return safe;
    }));

    const response = {
      connections: pageConnections,
      providerOptions,
      providerOrder: providerOrder.filter((id) => providerOptions.includes(id)),
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
      },
    };
    // Only serialize the sanitized response; database values can contain BigInts.
    return NextResponse.json(JSON.parse(JSON.stringify(response, (_key, value) => {
      if (!isBigInt(value)) return value;
      const number = Number(value);
      return Number.isSafeInteger(number) ? number : value.toString();
    })));
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
