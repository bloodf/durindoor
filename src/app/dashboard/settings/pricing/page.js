"use client";

import { useState, useEffect } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setCurrentPricing(data);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePricingUpdated = () => {
    loadPricing();
  };

  // Count total models with pricing
  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  // Get providers list
  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6" aria-label="Pricing settings">
      <PageHeader icon="payments" title="Pricing Settings" subtitle="Configure pricing rates for cost tracking and calculations" actions={<Button variant="primary" icon="edit" onClick={() => setShowModal(true)}>Edit Pricing</Button>} />
      <section aria-label="Pricing summary" className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Models" value={loading ? "…" : getModelCount()} hint="Models with configured pricing" />
        <StatCard label="Providers" value={loading ? "…" : getProviders().length} hint="Providers with pricing data" />
        <StatCard label="Status" value={loading ? "…" : "Active"} tone="success" hint="Cost tracking available" />
      </section>
      <Card padding={false}><CardHeader icon="calculate" title="How Pricing Works" subtitle="Rates are applied to each request" /><CardContent className="space-y-3 text-[13px] leading-relaxed text-dd-muted"><p><strong className="text-dd-text">Cost Calculation:</strong> Costs are calculated from token usage and pricing rates. Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate).</p><p><strong className="text-dd-text">Pricing Format:</strong> All rates are dollars per million tokens ($/1M tokens). Example: input rate 2.50 means $2.50 per 1,000,000 input tokens.</p><div><p className="font-medium text-dd-text">Token Types</p><ul className="mt-2 list-disc space-y-1 ps-5"><li><strong className="text-dd-text">Input:</strong> Standard prompt tokens</li><li><strong className="text-dd-text">Output:</strong> Completion or response tokens</li><li><strong className="text-dd-text">Cached:</strong> Cached input tokens</li><li><strong className="text-dd-text">Reasoning:</strong> Thinking tokens, falling back to output rate</li><li><strong className="text-dd-text">Cache Creation:</strong> Tokens used to create cache entries, falling back to input rate</li></ul></div><p><strong className="text-dd-text">Custom Pricing:</strong> Override default pricing for specific models. Reset to defaults any time to restore standard rates.</p></CardContent></Card>
      <Card padding={false}><CardHeader icon="price_check" title="Current Pricing Overview" subtitle="Configured provider rates" actions={<Button variant="ghost" icon="visibility" onClick={() => setShowModal(true)}>View Full Details</Button>} /><CardContent>{loading ? <div role="status" className="py-6 text-center text-[13px] text-dd-muted">Loading pricing data…</div> : currentPricing && Object.keys(currentPricing).length > 0 ? <div className="divide-y divide-dd-border-subtle">{Object.keys(currentPricing).slice(0, 5).map((provider) => <div key={provider} className="flex items-center justify-between py-3"><span className="font-mono text-[13px] font-medium text-dd-text">{provider.toUpperCase()}</span><span className="dd-tnum text-xs text-dd-muted">{Object.keys(currentPricing[provider]).length} models</span></div>)}{Object.keys(currentPricing).length > 5 ? <p className="pt-3 text-xs text-dd-muted">+ {Object.keys(currentPricing).length - 5} more providers</p> : null}</div> : <EmptyState icon="receipt_long" title="No pricing data available" message="Add pricing rates to enable cost tracking." action={{ label: "Edit Pricing", icon: "edit", onClick: () => setShowModal(true) }} />}</CardContent></Card>
      {showModal ? <PricingModal isOpen={showModal} onClose={() => setShowModal(false)} onSave={handlePricingUpdated} /> : null}
    </main>
  );
}
