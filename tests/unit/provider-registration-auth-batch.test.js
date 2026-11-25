// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Production registry, picker logic and dispatcher are intentionally not mocked here.
vi.mock("@/shared/hooks/useModelCaps", () => ({ useModelCaps: () => ({ getCaps: () => null }) }));
vi.mock("@/shared/hooks/useOrcaRouterCatalog", () => ({ useOrcaRouterCatalog: () => ({ models: [] }) }));
vi.mock("../../src/shared/ui/components/Modal.jsx", () => ({ default: ({ children }) => children }));
vi.mock("../../src/shared/ui/components/ProviderLogo.jsx", () => ({ ProviderLogo: () => null }));
vi.mock("../../src/shared/components/CapacityBadges", () => ({ default: () => null }));
vi.mock("@/lib/localDb", () => ({
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));
import registry from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { APIKEY_PROVIDERS, LIVE_CATALOG_PROVIDERS, OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";
import { resolveChatgptPlanDispatch } from "../../src/sse/services/chatgptPlanDispatch.js";
import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";

describe("production provider registration batch", () => {
  it("composes distinct identities, formats and discoverable MNN chat catalog", () => {
    for (const id of ["mnn-ai", "chatgpt-plan", "codex", "chatgpt-web"]) {
      expect(registry.filter((entry) => entry.id === id)).toHaveLength(1);
      expect(PROVIDERS[id]).toBeTruthy();
    }
    expect(APIKEY_PROVIDERS["mnn-ai"].name).toBe("MNN AI");
    expect(PROVIDER_MEDIA["mnn-ai"].serviceKinds).toEqual(["llm"]);
    expect(LIVE_CATALOG_PROVIDERS).toContain("mnn-ai");
    expect(OAUTH_PROVIDERS["chatgpt-plan"]).toMatchObject({ hidden: true, name: "ChatGPT Plan (owner-operated)" });
    expect(PROVIDERS["chatgpt-plan"].format).toBe("openai-responses");
    expect(OAUTH_PROVIDERS.codex.name).toBe("OpenAI Codex");
    expect(registry.find((entry) => entry.id === "chatgpt-web").display.name).toBe("ChatGPT Web");
    const picker = renderToStaticMarkup(React.createElement(ModelSelectModal, {
      isOpen: true, onClose: () => {}, onSelect: () => {},
      activeProviders: [{ provider: "chatgpt-plan", id: "owner", name: "Owner plan", isActive: true }],
    }));
    expect(picker).toContain("ChatGPT plan connection");
    expect(picker).toContain("Owner plan");
    expect(picker).toContain("Gateway API key scoped to this connection");
  });
  it("offers the MNN account catalog in the real picker", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const response = (body) => ({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/providers/mnn-one/models") return response({ models: [{ id: "synthetic-chat", name: "Synthetic chat" }] });
      const bodies = {
        "/api/settings": { hidePaidModels: false }, "/api/v1/models": { data: [] },
        "/api/combos": { combos: [] }, "/api/provider-nodes": { nodes: [] },
        "/api/models/custom": { models: [] }, "/api/models/disabled": { disabled: {} },
        "/api/models/auto-sync": { providers: {} },
      };
      if (!(url in bodies)) throw new Error(`Unexpected request ${url}`);
      return response(bodies[url]);
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(React.createElement(ModelSelectModal, {
        isOpen: true, onClose: () => {}, onSelect: () => {},
        activeProviders: [{ provider: "mnn-ai", id: "mnn-one", isActive: true }],
      })); });
      expect(fetch).toHaveBeenCalledWith("/api/providers/mnn-one/models");
      expect(container.textContent).toContain("Synthetic chat");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
  it("denies dispatch when disabled or without an explicit scoped connection", async () => {
    const original = process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT;
    try {
      delete process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT;
      const input = { planRequest: { verifiedKey: { id: "synthetic", isActive: true } }, providerRegistered: Boolean(PROVIDERS["chatgpt-plan"]), preferredConnectionId: "connection" };
      expect(await resolveChatgptPlanDispatch(input)).toBeNull();
      process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT = "1";
      expect(await resolveChatgptPlanDispatch(input)).toBeNull();
    } finally {
      if (original === undefined) delete process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT;
      else process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT = original;
    }
  });
});
