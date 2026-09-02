import React from "react";

import { Card } from "@/shared/ui/components/Card.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

import { mediaProviders } from "./mockData.js";

function ProviderStatus({ status }) {
  if (status === "1 Connected") {
    return <StatusDot tone="success" label={status} />;
  }

  if (status === "Disabled") {
    return <StatusDot tone="neutral" label={status} />;
  }

  return <span className="text-xs text-dd-muted">{status}</span>;
}

function ProviderCard({ provider }) {
  return (
    <Card hover className="flex min-w-0 items-center gap-3 p-4 hover:border-dd-accent">
      <ProviderLogo provider={provider.id} size={32} className="m-1" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="truncate text-[13px] font-semibold text-dd-text">{provider.name}</h2>
        <ProviderStatus status={provider.status} />
      </div>
    </Card>
  );
}

/** Mocked branded provider catalog; shell-level identity and actions come from its story. */
export default function MediaProvidersPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="deployed_code"
        title="Embedding"
        subtitle="Manage your Embedding providers"
      />

      <section aria-label="Embedding providers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {mediaProviders.map((provider) => (
          <ProviderCard key={provider.name} provider={provider} />
        ))}
      </section>
    </div>
  );
}
