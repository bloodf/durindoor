import { NextResponse } from "next/server";
import { buildModelsList, LLM_KIND } from "@/app/api/v1/models/buildModelsList.js";
import { canonicalizePolicyModelIdentity } from "@/sse/services/apiKeyPolicyIdentity.js";
import { getModelInfo } from "@/sse/services/model.js";

const POLICY_KINDS = [
  LLM_KIND,
  "image",
  "tts",
  "stt",
  "embedding",
  "moderation",
  "rerank",
  "imageToText",
  "webSearch",
  "webFetch",
  "music",
  "video",
];

export async function buildApiKeyPolicyCatalog() {
  const models = await buildModelsList(POLICY_KINDS);
  const catalog = new Map();
  for (const model of models) {
    if (!model?.id || model.owned_by === "combo") continue;
    let id = canonicalizePolicyModelIdentity(model.id);
    if (String(model.id).includes("/")) {
      const resolved = await getModelInfo(model.id);
      if (resolved?.provider && resolved?.model) {
        id = `${resolved.provider}/${resolved.model}`;
      }
    }
    if (!id) continue;
    const existing = catalog.get(id);
    if (existing) {
      if (model.kind && !existing.kinds.includes(model.kind)) existing.kinds.push(model.kind);
      continue;
    }
    catalog.set(id, {
      id,
      displayId: model.id,
      name: model.name || model.display_name || model.id,
      provider: id.includes("/") ? id.slice(0, id.indexOf("/")) : id,
      kinds: model.kind ? [model.kind] : [],
      capabilities: model.capabilities || {},
    });
  }
  return [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET() {
  try {
    return NextResponse.json({ models: await buildApiKeyPolicyCatalog() });
  } catch (error) {
    console.log("Error building API-key policy catalog:", error);
    return NextResponse.json({ error: "Failed to build API-key policy catalog" }, { status: 500 });
  }
}
