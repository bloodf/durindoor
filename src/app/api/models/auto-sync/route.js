import { NextResponse } from "next/server";
import { getProviderConnections, getSettings, getSyncedModelCatalogs } from "@/lib/localDb";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isString } from "@/shared/utils/typeChecks.js";
import {
  effectiveSyncedModels,
  getModelAutoSyncIntervalHours,
  isModelAutoSyncEnabled
} from "@/lib/modelAutoSync/catalog.js";
import {
  getPrunedModelReferences,
  isModelAutoSyncEligible,
  runModelAutoSync
} from "@/lib/modelAutoSync/runner.js";

export const dynamic = "force-dynamic";

function providerStatus(providerId, entry, settings) {
  const enabled = isModelAutoSyncEnabled(providerId, settings);
  const effective = enabled ? effectiveSyncedModels(entry, getModelsByProviderId(providerId)) : null;
  return {
    eligible: isModelAutoSyncEligible(providerId),
    enabled,
    syncedAt: entry?.syncedAt || null,
    lastAttemptAt: entry?.lastAttemptAt || null,
    error: entry?.error || null,
    newModelIds: entry?.newModelIds || [],
    removedModelIds: entry?.removedModelIds || [],
    // The effective list replaces the registry defaults while auto-sync is on
    // and a sync has succeeded; null means "use the registry".
    models: effective ? effective.map(({ id, name, kind }) => ({ id, name, kind })) : null
  };
}

/**
 * GET /api/models/auto-sync[?provider=id]
 * Per-provider sync status and effective model lists, plus combo members and
 * aliases that point at models the synced lists no longer have.
 */
export async function GET(request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider");
    const [settings, catalogs, connections] = await Promise.all([
      getSettings(), getSyncedModelCatalogs(), getProviderConnections({ isActive: true })
    ]);
    const ids = provider ? [provider] : [...new Set([
      ...Object.keys(catalogs),
      ...connections.map((c) => c.provider)
    ])].filter(isModelAutoSyncEligible);
    const providers = Object.fromEntries(ids.map((id) => [id, providerStatus(id, catalogs[id], settings)]));
    return NextResponse.json({
      intervalHours: getModelAutoSyncIntervalHours(settings),
      providers,
      prunedReferences: await getPrunedModelReferences(settings)
    });
  } catch (error) {
    console.log("Error reading model auto-sync status:", error?.message || error);
    return NextResponse.json({ error: "Failed to read model auto-sync status" }, { status: 500 });
  }
}

/**
 * POST /api/models/auto-sync  body: { provider? }
 * Sync now. With `provider`, only that provider; otherwise every provider
 * with auto-sync on. Ignores the interval.
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const provider = isString(body?.provider) ? body.provider.trim() : "";
  if (provider && !isModelAutoSyncEligible(provider)) {
    return NextResponse.json({ error: "Provider has no list-models API" }, { status: 400 });
  }
  try {
    const results = await runModelAutoSync({ providerIds: provider ? [provider] : null, force: true });
    return NextResponse.json({ results });
  } catch (error) {
    console.log("Model auto-sync failed:", error?.message || error);
    return NextResponse.json({ error: "Model auto-sync failed" }, { status: 500 });
  }
}
