import { NextResponse } from "next/server";
import { deleteCustomModel, deleteProviderConnectionsByProvider, deleteProviderNode, getCustomModels, getProviderConnections, getProviderNodeById, getProviderNodes, updateProviderConnection, updateProviderNode } from "@/models";
import { isValidProviderIconUrl } from "@/shared/utils/providerIcon";
import { normalizeSystemoneBaseUrl } from "open-sse/config/systemone.js";
import REGISTRY from "open-sse/providers/registry/index.js";


// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, iconUrl } = body;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }
    if (node.type === "systemone-compatible") {
      const value = prefix.trim();
      const reserved = REGISTRY.some((provider) =>
        [provider.id, provider.alias, provider.uiAlias, ...(provider.aliases || [])].includes(value));
      const duplicate = (await getProviderNodes()).some((candidate) => candidate.id !== id && candidate.prefix === value);
      if (reserved || duplicate) return NextResponse.json({ error: "Provider prefix already exists or is reserved" }, { status: 409 });
    }

    if (iconUrl !== undefined && !isValidProviderIconUrl(iconUrl)) {
      return NextResponse.json({ error: "Invalid icon URL" }, { status: 400 });
    }

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    let sanitizedBaseUrl = baseUrl.trim();

    // Sanitize Base URL for Anthropic Compatible
    if (node.type === "anthropic-compatible") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
    }

    // Sanitize Base URL for Custom Embedding (strip trailing slash and /embeddings)
    if (node.type === "custom-embedding") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
    }

    if (node.type === "systemone-compatible") {
      try { sanitizedBaseUrl = normalizeSystemoneBaseUrl(sanitizedBaseUrl); } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    if (node.type === "systemone-compatible" && prefix.trim() !== node.prefix) {
      const registered = (await getCustomModels()).some((model) =>
        (model.providerAlias === node.prefix || model.providerAlias === node.id) && (model.kind || model.type) === "systemone");
      if (registered) {
        return NextResponse.json({ error: "Remove and re-register System One models before changing prefix" }, { status: 409 });
      }
    }

    const updates = {
      name: name.trim(),
      prefix: prefix.trim(),
      baseUrl: sanitizedBaseUrl,
      ...(iconUrl !== undefined ? { iconUrl: iconUrl.trim() } : null)
    };

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
    }

    const updated = await updateProviderNode(id, updates);

    const connections = await getProviderConnections({ provider: id });
    await Promise.all(connections.map((connection) =>
    updateProviderConnection(connection.id, {
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        prefix: prefix.trim(),
        apiType: node.type === "openai-compatible" ? apiType : undefined,
        baseUrl: sanitizedBaseUrl,
        nodeName: updated.name
      }
    })
    ));

    return NextResponse.json({ node: updated });
  } catch (error) {
    console.log("Error updating provider node:", error);
    return NextResponse.json({ error: "Failed to update provider node" }, { status: 500 });
  }
}

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    await deleteProviderConnectionsByProvider(id);
    if (node.type === "systemone-compatible") {
      const models = (await getCustomModels()).filter((model) =>
        (model.providerAlias === node.prefix || model.providerAlias === node.id) && (model.kind || model.type) === "systemone");
      await Promise.all(models.map((model) => deleteCustomModel({ providerAlias: model.providerAlias, id: model.id, type: model.type || model.kind || "systemone" })));
    }
    await deleteProviderNode(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    const status = error?.code === "API_KEY_SCOPE_WOULD_BROADEN" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? error.message : "Failed to delete provider node" }, { status });
  }
}