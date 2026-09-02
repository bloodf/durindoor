import { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

import {
  apiKeyProviders,
  freeTierProviders,
  oauthProviders,
  providerStatusOptions,
} from "./mockData.js";

function ProviderCard({ provider }) {
  const [enabled, setEnabled] = useState(provider.enabled);

  return (
    <Card
      className={
        provider.disabled
          ? "flex min-w-0 items-center gap-3 p-4 opacity-60"
          : "flex min-w-0 items-center gap-3 p-4 transition-colors hover:border-dd-accent"
      }
    >
      <ProviderLogo provider={provider.logoProvider ?? provider.id} size={32} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[13px] font-semibold text-dd-text">{provider.name}</h3>
        <div className="mt-1 flex items-center">
          {provider.status === "active" ? (
            <StatusDot tone="success" label={provider.detail} />
          ) : (
            <Badge tone="neutral" size="sm">
              {provider.detail}
            </Badge>
          )}
        </div>
      </div>
      <Toggle
        checked={enabled}
        onChange={setEnabled}
        disabled={provider.disabled}
        size="sm"
        aria-label={`${enabled ? "Disable" : "Enable"} ${provider.name}`}
      />
    </Card>
  );
}

function SectionHeader({ id, title }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-sm font-semibold text-dd-text">
        {title}
      </h2>
      <Button variant="ghost" size="sm" icon="science">
        Test All
      </Button>
    </div>
  );
}

function ProviderSection({ id, title, providers }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <SectionHeader id={id} title={title} />
      {providers.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon="filter_alt_off"
            title="No providers match this filter"
            message="Choose another provider status or clear your search."
          />
        </Card>
      )}
    </section>
  );
}

export default function ProvidersPage({ initialStatus = "active" }) {
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState("");

  const matches = (provider) => {
    const statusMatches = status === "all" || provider.status === status;
    return statusMatches && provider.name.toLowerCase().includes(search.trim().toLowerCase());
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="dns"
        title="Providers"
        subtitle="Manage your AI provider connections"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          options={providerStatusOptions}
          value={status}
          onChange={setStatus}
          className="sm:w-52"
          aria-label="Provider status"
        />
        <Input
          icon="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search providers"
          aria-label="Search providers"
          className="sm:min-w-72"
        />
      </div>

      <section aria-labelledby="custom-providers-title" className="space-y-3">
        <SectionHeader
          id="custom-providers-title"
          title="Custom Providers (OpenAI/Anthropic Compatible)"
        />
        <Card padding={false}>
          <EmptyState
            icon="add_link"
            title="No custom providers yet"
            message="Connect an OpenAI- or Anthropic-compatible endpoint to route its models through DurinDoor."
          />
          <div className="-mt-6 flex flex-wrap justify-center gap-2 pb-10 px-4">
            <Button variant="primary" icon="add">
              Add OpenAI Compatible
            </Button>
            <Button variant="secondary">Add Anthropic Compatible</Button>
          </div>
        </Card>
      </section>

      <ProviderSection
        id="oauth-providers-title"
        title="OAuth Providers"
        providers={oauthProviders.filter(matches)}
      />

      <ProviderSection
        id="api-key-providers-title"
        title="API Key Providers"
        providers={apiKeyProviders.filter(matches)}
      />

      {status !== "active" ? (
        <ProviderSection
          id="free-tier-providers-title"
          title="Free Tier Providers"
          providers={freeTierProviders.filter(matches)}
        />
      ) : null}
    </div>
  );
}
