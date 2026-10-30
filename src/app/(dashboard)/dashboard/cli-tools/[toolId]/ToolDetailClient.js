"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CardSkeleton } from "@/shared/components";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { loadToolConfiguration } from "../toolConfiguration.js";
import { fallbackConnectionModels } from "../connectionModels";
import {
  ClaudeToolCard, CodexToolCard, DroidToolCard, OpenClawToolCard,
  HermesToolCard, DefaultToolCard, OpenCodeToolCard, CoworkToolCard,
  ClineToolCard, KiloToolCard, DeepSeekTuiToolCard,
  JcodeToolCard, GrokBuildToolCard, GenericCliToolCard,
} from "../components";
import { isBrowser } from "../../../../../shared/utils/typeChecks.js";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function ToolDetailClient({ toolId, machineId }) {
  const tool = CLI_TOOLS[toolId];
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [modelMappings, setModelMappings] = useState({});
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tailscaleEnabled, setTailscaleEnabled] = useState(false);
  const [tailscaleUrl, setTailscaleUrl] = useState("");
  const [apiKeys, setApiKeys] = useState([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const { providers, settings, tunnel, keys } = await loadToolConfiguration();
        if (!mounted) return;
        setConnections(providers.connections); setCloudEnabled(settings.cloudEnabled === true);
        setTunnelEnabled(!!(tunnel.tunnel?.enabled || tunnel.tunnel?.settingsEnabled));
        setTunnelPublicUrl(tunnel.tunnel?.publicUrl || "");
        setTailscaleEnabled(!!(tunnel.tailscale?.enabled || tunnel.tailscale?.settingsEnabled));
        setTailscaleUrl(tunnel.tailscale?.tunnelUrl || ""); setApiKeys(keys.keys);
        setLoadError("");
      } catch (error) {
        if (mounted) setLoadError(error.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [loadAttempt]);

  const getActiveProviders = () => connections.filter((c) => c.isActive !== false);

  const getAllAvailableModels = () => {
    const activeProviders = getActiveProviders();
    const models = [];
    const seenModels = new Set();
    activeProviders.forEach((conn) => {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      const providerModels = getModelsByProviderId(conn.provider);
      const modelList = providerModels.length > 0
        ? providerModels.map((m) => ({ id: m.id, prefix: alias }))
        : fallbackConnectionModels(conn).map((m) => ({ id: m.id, prefix: conn.providerSpecificData?.prefix || alias }));
      modelList.forEach(({ id, prefix }) => {
        const modelValue = `${prefix}/${id}`;
        if (!seenModels.has(modelValue)) {
          seenModels.add(modelValue);
          models.push({ value: modelValue, label: modelValue, provider: conn.provider, alias: prefix, connectionName: conn.name, modelId: id });
        }
      });
    });
    return models;
  };

  const handleModelMappingChange = useCallback((tId, alias, target) => {
    setModelMappings((prev) => {
      if (prev[tId]?.[alias] === target) return prev;
      return { ...prev, [tId]: { ...prev[tId], [alias]: target } };
    });
  }, []);

  const getBaseUrl = () => {
    if (tunnelEnabled && tunnelPublicUrl) return tunnelPublicUrl;
    if (cloudEnabled && CLOUD_URL) return CLOUD_URL;
    if (isBrowser()) return window.location.origin;
    return "http://localhost:20128";
  };

  const renderToolCard = () => {
    const availableModels = getAllAvailableModels();
    const hasActiveProviders = availableModels.length > 0;
    const commonProps = {
      tool,
      isExpanded: true,
      onToggle: () => {},
      baseUrl: getBaseUrl(),
      apiKeys,
      tunnelEnabled,
      tunnelPublicUrl,
      tailscaleEnabled,
      tailscaleUrl,
    };

    switch (toolId) {
      case "claude": return <ClaudeToolCard {...commonProps} activeProviders={getActiveProviders()} modelMappings={modelMappings[toolId] || {}} onModelMappingChange={(a, t) => handleModelMappingChange(toolId, a, t)} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "codex": return <CodexToolCard {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} />;
      case "opencode": return <OpenCodeToolCard {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} />;
      case "cowork": return <CoworkToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} cloudUrl={CLOUD_URL} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />;
      case "droid": return <DroidToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "openclaw": return <OpenClawToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "hermes": return <HermesToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "cline": return <ClineToolCard {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} />;
      case "kilo": return <KiloToolCard {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} />;
      case "deepseek-tui": return <DeepSeekTuiToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "jcode": return <JcodeToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "grok-build": return <GrokBuildToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      case "pi":
      case "crush":
      case "forge":
      case "smelt":
      case "codewhale":
        return <GenericCliToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} />;
      default: return <DefaultToolCard toolId={toolId} {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} cloudUrl={CLOUD_URL} />;
    }
  };

  if (!tool) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-[13px]">
        <Link href="/dashboard/cli-tools" className="inline-flex min-h-11 w-fit items-center gap-1 rounded-dd px-2 text-sm text-dd-muted outline-none hover:text-dd-text focus-visible:shadow-dd-focus">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
          Back to CLI Tools
        </Link>
        <EmptyState icon="search_off" title="Tool not found" message="Tool not found or disabled." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-[13px]">
      <Link href="/dashboard/cli-tools" className="inline-flex min-h-11 w-fit items-center gap-1 rounded-dd px-2 text-sm text-dd-muted outline-none hover:text-dd-text focus-visible:shadow-dd-focus">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        Back to CLI Tools
      </Link>
      <PageHeader icon={tool.icon || "terminal"} title={tool.name} subtitle={tool.description} />
      {loading ? <CardSkeleton /> : loadError ? <div role="alert" className="space-y-3 rounded-dd border border-dd-danger p-4"><p>{loadError}</p><Button icon="refresh" onClick={() => setLoadAttempt((value) => value + 1)}>Retry configuration</Button></div> : renderToolCard()}
    </div>
  );
}
