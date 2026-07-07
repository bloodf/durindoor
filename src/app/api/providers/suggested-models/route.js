import { NextResponse } from "next/server";
import { FILTERS } from "./filters.js";
import { getProviderConnections } from "@/models";
import modelscopeRegistry from "open-sse/providers/registry/modelscope.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");
  const provider = searchParams.get("provider");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  try {
    const headers = {};
    if (provider === "modelscope") {
      const modelscopeUrl = modelscopeRegistry.modelsFetcher?.url;
      if (modelscopeUrl && url === modelscopeUrl) {
        const connections = await getProviderConnections({ provider: "modelscope", isActive: true });
        const apiKey = connections[0]?.apiKey;
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    const res = await fetch(url, { headers });
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
