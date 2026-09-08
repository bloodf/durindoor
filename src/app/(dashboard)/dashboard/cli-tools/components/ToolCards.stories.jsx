import React from "react";
import { within, expect } from "storybook/test";
import ClaudeToolCard from "./ClaudeToolCard";
import AntigravityToolCard from "./AntigravityToolCard";
import MitmServerCard from "./MitmServerCard";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";

const CLAUDE_TOOL = CLI_TOOLS.claude;
const ANTGRAVITY_TOOL = MITM_TOOLS.antigravity;

// Production connection descriptor contract: id, provider, authType, name,
// isActive, testStatus, priority, providerSpecificData. Used by the parent
// ToolDetailClient and consumed by ModelSelectModal/ApiKeySelect.
const OPENAI_PROVIDER = {
  id: "openai-main",
  provider: "openai",
  authType: "apikey",
  name: "OpenAI",
  isActive: true,
  testStatus: "active",
  priority: 1,
  providerSpecificData: {},
};

const baseRoutes = {
  "GET /api/cli-tools/claude-settings": {
    body: { installed: true, hasBackup: true, settings: { env: { ANTHROPIC_BASE_URL: "http://localhost:20128/v1" } } },
  },
  "GET /api/models/alias": { body: { aliases: { sonnet: "anthropic/claude-sonnet-4-5" } } },
  "GET /api/settings": { body: { ccFilterNaming: false } },
  "GET /api/cli-tools/antigravity-mitm/alias": { body: { aliases: {} } },
  "GET /api/cli-tools/antigravity-mitm": {
    body: { running: false, certExists: true, certTrusted: false, dnsConfigured: false, hasCachedPassword: true, needsSudoPassword: false, isWin: false, isAdmin: false, mitmRouterBaseUrl: "http://localhost:20128" },
  },
};

const antRunningRoutes = {
  ...baseRoutes,
  "GET /api/cli-tools/antigravity-mitm": {
    body: { running: true, certExists: true, certTrusted: true, dnsConfigured: true, hasCachedPassword: true, needsSudoPassword: false, isWin: false, isAdmin: false, mitmRouterBaseUrl: "http://localhost:20128" },
  },
};

const claudeArgs = {
  tool: CLAUDE_TOOL,
  onToggle: () => {},
  activeProviders: [OPENAI_PROVIDER],
  modelMappings: { sonnet: "anthropic/claude-sonnet-4-5", opus: "anthropic/claude-opus-4-1" },
  onModelMappingChange: () => {},
  baseUrl: "http://localhost:20128",
  hasActiveProviders: true,
  apiKeys: [],
  cloudEnabled: false,
};

export default {
  title: "Durin DS/Production Pages/cli-tools/ToolCards",
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude", routes: baseRoutes } },
};

export const ClaudeCollapsed = {
  render: () => <ClaudeToolCard {...claudeArgs} isExpanded={false} initialStatus={{ installed: true, settings: { env: {} } }} />,
};

export const ClaudeExpanded = {
  render: () => <ClaudeToolCard {...claudeArgs} isExpanded initialStatus={{ installed: true, settings: { env: { ANTHROPIC_BASE_URL: "http://localhost:20128/v1" } } }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole("button", { name: /claude code/i })).toHaveAttribute("aria-expanded", "true");
  },
};

export const AntigravityInactive = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/antigravity", routes: baseRoutes } },
  render: () => (
    <AntigravityToolCard
      tool={ANTGRAVITY_TOOL}
      isExpanded
      onToggle={() => {}}
      baseUrl="http://localhost:20128"
      apiKeys={[]}
      activeProviders={[OPENAI_PROVIDER]}
      hasActiveProviders
      cloudEnabled={false}
      initialStatus={{ running: false }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = await canvas.findByRole("button", { name: /antigravity/i });
    expect(header).toBeInTheDocument();
    expect(canvas.getByRole("button", { name: /start mitm/i })).toBeInTheDocument();
  },
};

export const AntigravityActive = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/antigravity", routes: antRunningRoutes } },
  render: () => (
    <AntigravityToolCard
      tool={ANTGRAVITY_TOOL}
      isExpanded
      onToggle={() => {}}
      baseUrl="http://localhost:20128"
      apiKeys={[]}
      activeProviders={[OPENAI_PROVIDER]}
      hasActiveProviders
      cloudEnabled={false}
      initialStatus={{ running: true, certExists: true, certTrusted: true, dnsConfigured: true }}
    />
  ),
};

export const MitmServerStopped = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", routes: baseRoutes } },
  render: () => <MitmServerCard apiKeys={[]} cloudEnabled={false} />,
};

export const MitmServerRunning = {
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools", routes: antRunningRoutes } },
  render: () => <MitmServerCard apiKeys={[{ name: "Primary", maskedKey: "sk_••••abcd" }]} cloudEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByText(/running/i)).toBeInTheDocument();
  },
};
