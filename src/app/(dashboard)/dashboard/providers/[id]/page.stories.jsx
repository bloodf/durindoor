import { isString } from "@/shared/utils/typeChecks.js";
import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ProviderDetailPage from "./page";
import { AI_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/providers.js";
import { getModelsByProviderId } from "@/shared/constants/models.js";
import { createRoutingFixture } from "@/shared/ui/v5/preservation/routing-fixtures.js";

// Kept aligned with PROVIDER_MODELS_CONFIG by the focused redesign test.
// This public ID list avoids importing server model-fetch handlers in the browser.
const REVIEW_MODEL_LIST_PROVIDERS = new Set(["chatplayground", "empiriolabs", "opencode-server", "replicate", "commandcode", "claude", "gemini", "gemini-interactions", "qwen", "kimi-web", "codex", "antigravity", "ghe-copilot", "github", "openai", "openference", "openrouter", "anthropic", "alicode", "alicode-intl", "volcengine-ark", "byteplus", "deepseek", "groq", "xai", "mistral", "muse-code", "perplexity", "together", "fireworks", "cerebras", "cohere", "nebius", "novita", "llmtr", "siliconflow", "hyperbolic", "nan", "paraloncloud", "bai", "ollama", "nanobanana", "chutes", "nvidia", "assemblyai", "vercel-ai-gateway", "hcnsec", "dothoosh", "kimchi", "cursor", "kiro", "qoder", "qoder-cn", "gemini-cli", "agy", "ollama-local", "mlx", "typesafe", "venice", "orcarouter", "xiaomi-mimo", "xiaomi-mimo-token-plan", "xiaomi-tokenplan", "devin-cli-agentic", "gisoo"]);
const REVIEW_NOT_SYNCABLE = new Set(["openrouter", "orcarouter", "ollama-local", "tokenharbor", "demonroute"]);

/** Fresh isolated data when navigating from one provider's story to another. */
function providerFixture(providerId) {
  const provider = AI_PROVIDERS[providerId];
  const models = getModelsByProviderId(providerId).map(({ id, name, kind, capabilities }) => ({ id, name, kind, capabilities }));
  const eligible = !REVIEW_NOT_SYNCABLE.has(providerId) && (REVIEW_MODEL_LIST_PROVIDERS.has(providerId) || isString(provider?.modelsFetcher?.url));
  const fixture = createRoutingFixture({
    provider: providerId,
    connections: provider ? [{ id: `review-${providerId}`, provider: providerId, authType: OAUTH_PROVIDERS[providerId] ? "oauth" : "apikey", name: `${provider.name || providerId} review connection`, isActive: true, testStatus: "active", priority: 1, providerSpecificData: {} }] : [],
    settings: { modelAutoSyncProviders: { [providerId]: eligible } },
    enabledModels: [],
  });
  let customModels = [];
  let aliases = {};
  const routes = {
    ...fixture.routes,
    [`GET /api/providers/review-${providerId}/models`]: { body: { models } },
    "GET /api/models/alias": () => ({ body: { aliases: { ...aliases } } }),
    "PUT /api/models/alias": async (request) => {
      const { model, alias } = await request.json();
      aliases = { ...aliases, [alias]: model };
      return { body: { success: true } };
    },
    "DELETE /api/models/alias": (request) => {
      const alias = new URL(request.url).searchParams.get("alias");
      aliases = Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== alias));
      return { body: { success: true } };
    },
    "GET /api/models/custom": () => ({ body: { models: structuredClone(customModels) } }),
    "POST /api/models/custom": async (request) => {
      const model = await request.json();
      customModels = [...customModels.filter((item) => item.id !== model.id || item.providerAlias !== model.providerAlias), model];
      return { body: { success: true, model } };
    },
    "PATCH /api/models/custom": async (request) => {
      const patch = await request.json();
      customModels = customModels.map((item) => item.id === patch.id && item.providerAlias === patch.providerAlias ? { ...item, ...patch } : item);
      return { body: { success: true } };
    },
    "DELETE /api/models/custom": (request) => {
      const query = new URL(request.url).searchParams;
      customModels = customModels.filter((item) => item.id !== query.get("id") || item.providerAlias !== query.get("providerAlias"));
      return { body: { success: true } };
    },
    "GET /api/models/auto-sync": () => {
      const enabled = fixture.snapshot().settings.modelAutoSyncProviders[providerId] === true;
      return { body: { intervalHours: 24, providers: { [providerId]: { eligible, enabled, syncedAt: eligible ? "2026-10-08T12:00:00Z" : null, lastAttemptAt: null, error: null, newModelIds: [], removedModelIds: [], models: eligible && enabled ? models : null } } } };
    },
    "POST /api/models/auto-sync": async (request) => {
      const payload = await request.json();
      if (payload.provider !== providerId) return { status: 400, body: { error: "Review provider mismatch" } };
      if (!eligible) return { status: 400, body: { error: "Provider has no list-models API" } };
      return { body: { results: [{ providerId, status: "synced", modelCount: models.length }] } };
    },
  };
  return { routes };
}

const baseConnection = {
  id: "openai-main",
  provider: "openai",
  authType: "apikey",
  name: "Production",
  isActive: true,
  testStatus: "active",
  priority: 1,
  providerSpecificData: {},
};

const detailFixture = createRoutingFixture({ connections: [baseConnection] });
const baseRoutes = {
  ...detailFixture.routes,
  "GET /api/providers": { body: { connections: [baseConnection] } },
  "GET /api/provider-nodes": { body: { nodes: [] } },
  "GET /api/proxy-pools": { body: { proxyPools: [] } },
  "GET /api/models/alias": { body: { aliases: {} } },
  "GET /api/models/custom": { body: { models: [] } },
  "GET /api/models/disabled": { body: { ids: [] } },
};
const openaiMeta = {
  title: "Production/providers/ProviderDetailPage",
  component: ProviderDetailPage,
  beforeEach: () => detailFixture.reset(),
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/openai",
      params: { id: "openai" },
      providerFixture,
      routes: baseRoutes,
    },
  },
};

export default openaiMeta;

/** Live detail view. Parent scenario reaches ConnectionRow, ModelRow, and shared detail modals through their real triggers. */
export const OpenAIDetail = {};

/** DS Retry-delay and Thinking-mode listboxes use real settings handlers; the request shape matches the page's settings fetch. */
export const SettingsControls = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const retryDelay = await canvas.findByLabelText("Retry delay");
    await userEvent.click(retryDelay);
    await userEvent.click(await within(document.body).findByRole("option", { name: "Retry: 15s" }));
    await expect(retryDelay).toHaveTextContent("Retry: 15s");
    await waitFor(() => expect(detailFixture.snapshot().settings.retryDelayByProvider.openai).toBe(15));
  },
};

/** Compatible provider branch renders CompatibleModelsSection and opens private bulk proxy controls. */
export const CompatibleBranch = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/oc-prod",
      params: { id: "oc-prod" },
      routes: {
        ...baseRoutes,
        "GET /api/proxy-pools": { body: { proxyPools: [{ id: "pool-eu", name: "EU Pool", isActive: true }] } },
        "GET /api/provider-nodes": {
          body: {
            nodes: [
              {
                id: "oc-prod",
                name: "OpenAI Compatible (Prod)",
                prefix: "oc-prod",
                apiType: "chat",
                baseUrl: "https://api.openai.com/v1",
                type: "openai-compatible",
              },
            ],
          },
        },
        "GET /api/providers": {
          body: {
            connections: [
              {
                ...baseConnection,
                id: "oc-prod-main",
                provider: "oc-prod",
              },
            ],
          },
        },
        "GET /api/models/disabled": { body: { ids: [] } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Apply Proxy" }));
    const dialog = await waitFor(() => {
      const node = body.getByRole("dialog", { name: /apply proxy \((?:all )?1 connections\)/i });
      expect(node).toBeVisible();
      return node;
    });
    await Promise.all(dialog.getAnimations({ subtree: true }).filter((animation) => Number.isFinite(animation.effect?.getTiming?.().iterations)).map(({ finished }) => finished.catch(() => {})));
    const dialogScope = within(dialog);
    await expect(dialogScope.getByText("One-to-one (rotate)")).toBeVisible();
    await expect(dialogScope.getByText("EU Pool")).toBeVisible();
    await userEvent.click(dialogScope.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Apply Proxy" })).toBeVisible();
  },
};

/** Retained-open parent scene, separate from CompatibleBranch's cancellation. */
export const CompatibleProxyOpen = {
  parameters: CompatibleBranch.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Apply Proxy" }));
    const dialog = await within(document.body).findByRole("dialog", { name: /apply proxy \((?:all )?1 connections\)/i });
    const form = within(dialog);
    await waitFor(() => expect(dialog).toBeVisible());
    await waitFor(() => expect(form.getByText("One-to-one (rotate)")).toBeVisible());
    await waitFor(() => expect(form.getByText("EU Pool")).toBeVisible());
    await expect(form.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
  },
};

export const MnnAiConnection = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/mnn-ai", params: { id: "mnn-ai" }, routes: providerFixture("mnn-ai").routes } },
};

const webSessionStory = (providerId) => ({
  parameters: { storyFixture: { scenario: "default", pathname: `/dashboard/providers/${providerId}`, params: { id: providerId }, routes: providerFixture(providerId).routes } },
});

export const ClaudeWebConnection = webSessionStory("claude-web");
export const GeminiWebConnection = webSessionStory("gemini-web");
export const DeepseekWebConnection = webSessionStory("deepseek-web");
export const DoubaoWebConnection = webSessionStory("doubao-web");
export const ZaiWebConnection = webSessionStory("zai-web");
export const ChatgptWebCodexConnection = webSessionStory("chatgpt-web-codex");

// Registration batch B (#2034): API-key, web-session and free providers.
export const HelyxaiConnection = webSessionStory("helyxai");
export const TabitokenConnection = webSessionStory("tabitoken");
export const TwinmindConnection = webSessionStory("twinmind");
export const HyperagentConnection = webSessionStory("hyperagent");
export const MaxaiConnection = webSessionStory("maxai");
export const LmarenaConnection = webSessionStory("lmarena");
export const ChatplaygroundConnection = webSessionStory("chatplayground");
export const CloudflarePlaygroundConnection = webSessionStory("cloudflare-playground");
export const PoeConnection = webSessionStory("poe");
export const G4fGeminiConnection = webSessionStory("g4f-gemini");
export const G4fNvidiaConnection = webSessionStory("g4f-nvidia");
export const G4fOllamaConnection = webSessionStory("g4f-ollama");
export const G4fPollinationsConnection = webSessionStory("g4f-pollinations");
