import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getSettings } from "@/lib/localDb";
import { effectiveSyncedModels, isModelAutoSyncEnabled } from "@/lib/modelAutoSync/catalog.js";
import { loadModelMetadataSnapshot, materializeRequestModel } from "@/sse/services/model.js";

// GET /api/models - Cache-only, provider-scoped models with aliases.
export async function GET() {
  try {
    const [modelAliases, disabled, settings, snapshot] = await Promise.all([
      getModelAliases(), getDisabledModels(), getSettings(), loadModelMetadataSnapshot(),
    ]);
    const staticByProvider = new Map();
    for (const [alias, rows] of Object.entries(PROVIDER_MODELS)) {
      const providerId = resolveProviderId(alias);
      if (!staticByProvider.has(providerId)) staticByProvider.set(providerId, rows);
    }
    const providerIds = new Set([...staticByProvider.keys(), ...Object.keys(snapshot.syncedCatalogs)]);
    const models = [];
    for (const providerId of providerIds) {
      const provider = getProviderAlias(providerId);
      const staticRows = staticByProvider.get(providerId) || [];
      // Shared metadata enriches only the selected roster; it never grants
      // access. A successful scoped sync replaces static rows only when enabled.
      const synced = isModelAutoSyncEnabled(providerId, settings)
        ? effectiveSyncedModels(snapshot.syncedCatalogs[providerId], staticRows)
        : null;
      const rows = synced || staticRows;
      const blocked = disabled[provider] || disabled[providerId] || [];
      for (const row of rows) {
        if (blocked.includes(row.id)) continue;
        const resolved = materializeRequestModel(providerId, row, provider, snapshot);
        const fullModel = `${provider}/${row.id}`;
        models.push({
          provider,
          model: row.id,
          name: row.name || row.id,
          fullModel,
          alias: modelAliases[fullModel] || row.id,
          // Includes independently known limits/defaults and every resolved
          // capability. Unknown ceilings stay unknown; no runtime token floor.
          caps: resolved.capabilities,
        });
      }
    }
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
