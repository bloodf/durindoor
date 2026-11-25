import { NextResponse } from "next/server";
import { canManageAccessConfig } from "@/dashboardGuard";
import { deleteProviderNodeWithConnections, getCustomModels, getProviderConnections, getProviderNodeById, getProviderNodes, updateProviderConnection, updateProviderNode } from "@/models";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_NODE_INVALID, validateProviderNode } from "@/lib/providerNodes/validateNode";

// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  if (!(await canManageAccessConfig(request))) {
    return NextResponse.json({ error: "Updating a provider node requires an operator session" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    const checked = validateProviderNode(body, { type: node.type, strict: true });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    const { name: nodeName, prefix: nodePrefix, apiType, baseUrl: sanitizedBaseUrl, iconUrl } = checked.value;

    if (node.type === "systemone-compatible") {
      const reserved = REGISTRY.some((provider) =>
        [provider.id, provider.alias, provider.uiAlias, ...(provider.aliases || [])].includes(nodePrefix));
      const duplicate = (await getProviderNodes()).some((candidate) => candidate.id !== id && candidate.prefix === nodePrefix);
      if (reserved || duplicate) return NextResponse.json({ error: "Provider prefix already exists or is reserved" }, { status: 409 });
    }

    if (node.type === "systemone-compatible" && nodePrefix !== node.prefix) {
      const registered = (await getCustomModels()).some((model) =>
        (model.providerAlias === node.prefix || model.providerAlias === node.id) && (model.kind || model.type) === "systemone");
      if (registered) {
        return NextResponse.json({ error: "Remove and re-register System One models before changing prefix" }, { status: 409 });
      }
    }

    const updates = {
      name: nodeName,
      prefix: nodePrefix,
      baseUrl: sanitizedBaseUrl,
      ...(iconUrl !== undefined ? { iconUrl } : null)
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
        prefix: nodePrefix,
        apiType: node.type === "openai-compatible" ? apiType : undefined,
        baseUrl: sanitizedBaseUrl,
        nodeName: updated.name
      }
    })
    ));

    return NextResponse.json({ node: updated });
  } catch (error) {
    if (error?.code === PROVIDER_NODE_INVALID) return NextResponse.json({ error: error.message }, { status: error.status });
    console.log("Error updating provider node:", error);
    return NextResponse.json({ error: "Failed to update provider node" }, { status: 500 });
  }
}

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export async function DELETE(request, { params }) {
  if (!(await canManageAccessConfig(request))) {
    return NextResponse.json({ error: "Deleting a provider node requires an operator session" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    await deleteProviderNodeWithConnections(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    const status = error?.code === "API_KEY_SCOPE_WOULD_BROADEN" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? error.message : "Failed to delete provider node" }, { status });
  }
}
