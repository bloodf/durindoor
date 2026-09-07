"use client";

import { useState, useEffect } from "react";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { MitmServerCard, MitmToolCard } from "@/app/(dashboard)/dashboard/cli-tools/components";

export default function MitmPageClient() {
  const [connections, setConnections] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [expandedTool, setExpandedTool] = useState(null);
  const [mitmStatus, setMitmStatus] = useState({ running: false, certExists: false, dnsStatus: {}, hasCachedPassword: false });

  useEffect(() => {
    fetchConnections();
    fetchApiKeys();
    fetchAliases();
    fetchCloudSettings();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch { /* ignore */ }
  };

  const fetchApiKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  };

  const fetchAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      if (res.ok) {
        const data = await res.json();
        setModelAliases(data.aliases || {});
      }
    } catch { /* ignore */ }
  };

  const fetchCloudSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setCloudEnabled(data.cloudEnabled || false);
      }
    } catch { /* ignore */ }
  };

  const getActiveProviders = () => connections.filter(c => c.isActive !== false);

  const hasActiveProviders = () => {
    const active = getActiveProviders();
    return active.some(conn =>
      getModelsByProviderId(conn.provider).length > 0 ||
      isOpenAICompatibleProvider(conn.provider) ||
      isAnthropicCompatibleProvider(conn.provider)
    );
  };

  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader icon="security" title="MITM Proxy" subtitle="Redirect supported IDE traffic through configured providers" />
      <Card padding={false} className="border-dd-warning/40"><CardContent className="flex items-start gap-3"><span className="material-symbols-outlined shrink-0 text-dd-warning" aria-hidden="true">warning</span><div className="space-y-1"><Badge tone="warning">Use with care</Badge><p className="text-[13px] leading-relaxed text-dd-text">MITM intercepts HTTPS traffic from IDE tools through a local CA to redirect requests to your providers. It may violate tool terms and risk account bans.</p></div></CardContent></Card>
      <MitmServerCard apiKeys={apiKeys} cloudEnabled={cloudEnabled} onStatusChange={setMitmStatus} />
      <section className="grid gap-4" aria-label="MITM tool configuration">{mitmTools.map(([toolId, tool]) => <MitmToolCard key={toolId} tool={tool} isExpanded={expandedTool === toolId} onToggle={() => setExpandedTool(expandedTool === toolId ? null : toolId)} serverRunning={mitmStatus.running} dnsActive={mitmStatus.dnsStatus?.[toolId] || false} hasCachedPassword={mitmStatus.hasCachedPassword || false} needsSudoPassword={mitmStatus.needsSudoPassword !== false} isWin={mitmStatus.isWin === true} apiKeys={apiKeys} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders()} modelAliases={modelAliases} cloudEnabled={cloudEnabled} onDnsChange={(data) => setMitmStatus((prev) => ({ ...prev, dnsStatus: data.dnsStatus ?? prev.dnsStatus }))} />)}</section>
    </div>
  );
}
