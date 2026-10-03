import { describe, expect, it } from "vitest";
import { discoverOllamaCatalog } from "../../open-sse/services/ollamaCatalog.js";

function response(body, ok = true) {
  return { ok, json: async () => body };
}

function fetcher({ ps = null, show = {} } = {}) {
  return (path, init) => {
    if (path === "/api/tags") return Promise.resolve(response({ models: [{ name: "llama3.2:1b" }, { name: "nomic-embed-text:latest" }] }));
    if (path === "/api/ps") return Promise.resolve(ps ? response({ models: ps }) : response({}, false));
    const id = JSON.parse(init.body).model;
    return Promise.resolve(response(show[id] || {}));
  };
}

describe("Ollama catalog", () => {
  it("uses served context and declared capabilities", async () => {
    const result = await discoverOllamaCatalog({
      host: "http://one", accountId: "a",
      fetchImpl: fetcher({
        ps: [{ name: "llama3.2:1b", context_length: 4096 }],
        show: {
          "llama3.2:1b": { capabilities: ["completion", "tools"], model_info: { "llama.context_length": 131072 } },
          "nomic-embed-text:latest": { capabilities: ["embedding"] },
        },
      }),
    });
    expect(result.models).toEqual([
      { id: "llama3.2:1b", name: "llama3.2:1b", kind: "llm", capabilities: { tools: true, vision: false, contextWindow: 4096 } },
      { id: "nomic-embed-text:latest", name: "nomic-embed-text:latest", kind: "embedding", capabilities: { tools: false, vision: false } },
    ]);
  });

  it("keeps observed served context scoped to endpoint and account", async () => {
    await discoverOllamaCatalog({ host: "http://two", accountId: "a", fetchImpl: fetcher({ ps: [{ name: "llama3.2:1b", context_length: 4096 }], show: { "llama3.2:1b": { capabilities: ["completion"], model_info: { "llama.context_length": 131072 } } } }) });
    const cached = await discoverOllamaCatalog({ host: "http://two", accountId: "a", fetchImpl: fetcher({ show: { "llama3.2:1b": { capabilities: ["completion"], model_info: { "llama.context_length": 131072 } } } }) });
    const otherHost = await discoverOllamaCatalog({ host: "http://three", accountId: "a", fetchImpl: fetcher({ show: { "llama3.2:1b": { capabilities: ["completion"], model_info: { "llama.context_length": 131072 } } } }) });
    expect(cached.models[0].capabilities.contextWindow).toBe(4096);
    expect(otherHost.models[0].capabilities.contextWindow).toBeUndefined();
  });

  it("uses tag capabilities without show and keeps model enrichment on show failure", async () => {
    const seeded = await discoverOllamaCatalog({
      host: "http://four", accountId: "a",
      fetchImpl: fetcher({ show: { "llama3.2:1b": { capabilities: ["completion", "tools"] } } }),
    });
    const fromTags = await discoverOllamaCatalog({
      host: "http://four", accountId: "a",
      fetchImpl: (path) => {
        if (path === "/api/tags") return Promise.resolve(response({ models: [{ name: "llama3.2:1b", capabilities: ["completion", "tools"] }] }));
        if (path === "/api/ps") return Promise.resolve(response({}, false));
        throw new Error("show must not run");
      },
    });
    expect(seeded.models[0].capabilities).toEqual({ tools: true, vision: false });
    expect(fromTags.models[0].capabilities).toEqual({ tools: true, vision: false });
  });
});
