import { beforeEach, describe, expect, it, vi } from "vitest";

import { getNodeReportedModalities, _resetNodeModalitiesCache } from "../../open-sse/providers/nodeModalities.js";

const P = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
const BASE = "http://localhost:1234";
const CREDS = { providerSpecificData: { baseUrl: `${BASE}/v1` } };
// /models describes a sibling model only.
const MODELS = { data: [{ id: "text-model", input_modalities: ["text"] }, { id: "vision-model" }] };

const route = (bodies) => vi.fn(async (url) => ({ ok: Boolean(bodies[url]), json: async () => bodies[url] || {} }));
const urls = (f) => f.mock.calls.map(([url]) => url);

describe("compatible-node modality discovery per requested model", () => {
  beforeEach(() => {
    _resetNodeModalitiesCache();
  });

  it("consults LM Studio when /models describes only other models, and caches both lists", async () => {
    const f = route({
      [`${BASE}/v1/models`]: MODELS,
      [`${BASE}/api/v0/models`]: { data: [{ id: "vision-model", type: "vlm" }] },
    });

    expect(await getNodeReportedModalities(P, "vision-model", CREDS, f)).toEqual({ vision: true });
    expect(await getNodeReportedModalities(P, "vision-model", CREDS, f)).toEqual({ vision: true });
    expect(urls(f)).toEqual([`${BASE}/v1/models`, `${BASE}/api/v0/models`]);
  });

  it("consults Ollama /api/show for the requested model when neither list describes it", async () => {
    const f = route({
      [`${BASE}/v1/models`]: MODELS,
      [`${BASE}/api/show`]: { capabilities: ["completion", "vision"] },
    });

    expect(await getNodeReportedModalities(P, "vision-model", CREDS, f)).toEqual({ vision: true });
    expect(urls(f)).toEqual([`${BASE}/v1/models`, `${BASE}/api/v0/models`, `${BASE}/api/show`]);
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ model: "vision-model" });
  });

  it("lets the requested model's own /models metadata win over LM Studio and Ollama", async () => {
    const f = route({
      [`${BASE}/v1/models`]: MODELS,
      [`${BASE}/api/v0/models`]: { data: [{ id: "text-model", type: "vlm" }] },
      [`${BASE}/api/show`]: { capabilities: ["vision"] },
    });

    expect(await getNodeReportedModalities(P, "text-model", CREDS, f)).toEqual({});
    expect(urls(f)).toEqual([`${BASE}/v1/models`]);
  });
});
