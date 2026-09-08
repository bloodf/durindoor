import React from "react";
import { within, userEvent, expect, waitFor } from "storybook/test";
import ToolDetailClient from "./ToolDetailClient";
import MitmLinkCard from "../components/MitmLinkCard";
import { MITM_TOOLS } from "@/shared/constants/cliTools";

const routes = {
  "GET /api/providers": { body: { connections: [{ id: "openai-main", provider: "openai", authType: "apikey", name: "OpenAI", isActive: true, testStatus: "active", priority: 1, defaultModel: "gpt-4.1", providerSpecificData: {} }] } },
  "GET /api/settings": { body: { cloudEnabled: false, ccFilterNaming: false } },
  "GET /api/tunnel/status": { body: { tunnel: { enabled: false, publicUrl: "" }, tailscale: { enabled: false, tunnelUrl: "" } } },
  "GET /api/keys": { body: { keys: [{ name: "Primary", maskedKey: "sk_••••" }] } },
  "GET /api/cli-tools/claude-settings": { body: { installed: true, has9Router: true, hasBackup: true, settings: { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20128/v1", CLAUDE_CODE_MAX_CONTEXT_TOKENS: "198000" } } } },
  "GET /api/models/alias": { body: { aliases: {} } },
  "GET /api/cli-tools/antigravity-mitm/alias": { body: { aliases: {} } },
};

export default {
  title: "Durin DS/Production Pages/cli-tools/ToolDetailClient",
  component: ToolDetailClient,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/cli-tools/claude", params: { toolId: "claude" }, routes } },
};

const scenario = (toolId) => ({
  args: { toolId, machineId: "story-machine" },
  parameters: { storyFixture: { scenario: "default", pathname: `/dashboard/cli-tools/${toolId}`, params: { toolId }, routes } },
});

// 13 explicit dispatched private configuration widgets + 1 default-card branch (Cursor).
// Each scenario drives live production ToolDetailClient dispatch with real fixture contracts.
export const Claude = scenario("claude");
export const Codex = scenario("codex");
export const OpenCode = scenario("opencode");
export const Cowork = scenario("cowork");
export const Droid = scenario("droid");
export const OpenClaw = scenario("openclaw");
export const Hermes = scenario("hermes");
export const Copilot = { render: () => <MitmLinkCard tool={MITM_TOOLS.copilot} /> };
export const Cline = scenario("cline");
export const Kilo = scenario("kilo");
export const DeepSeekTui = scenario("deepseek-tui");
export const Jcode = scenario("jcode");
export const GrokBuild = scenario("grok-build");
export const Cursor = scenario("cursor");

export const ClaudeLoaded = {
  ...scenario("claude"),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    expect(await body.findByRole("heading", { name: /claude/i })).toBeInTheDocument();
    const endpoint = await body.findByRole("combobox", { name: "Endpoint" });
    await waitFor(() => expect(endpoint).toHaveTextContent("Local (127.0.0.1)"));
    expect(body.getByText("Context window")).toBeInTheDocument();
    await waitFor(() => expect(body.getAllByRole("combobox").at(-1)).toHaveTextContent("200K"));
  },
};

export const ClaudeEndpointMenu = {
  ...scenario("claude"),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const endpoint = await body.findByRole("combobox", { name: "Endpoint" });
    await userEvent.click(endpoint);
    const endpointMenu = body.getByRole("listbox", { name: "Endpoint" });
    expect(within(endpointMenu).getByRole("option", { name: "Local (127.0.0.1)" })).toHaveAttribute("aria-selected", "true");
  },
};
