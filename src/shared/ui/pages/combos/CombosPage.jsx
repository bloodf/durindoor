import React from "react";

import { Card } from "@/shared/ui/components/Card.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";

import { combos as defaultCombos, strategyDescriptions, strategyOptions } from "./mockData.js";

function StrategyGuide() {
  return (
    <Card padding={false}>
      <div className="border-b border-dd-border-subtle px-5 py-4">
        <h2 className="text-sm font-semibold text-dd-text">Routing strategies</h2>
        <p className="mt-0.5 text-xs text-dd-muted">Choose how each combo selects its next model.</p>
      </div>
      <dl className="grid divide-y divide-dd-border-subtle sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {strategyDescriptions.map((strategy) => (
          <div key={strategy.name} className="flex gap-3 px-4 py-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
                {strategy.icon}
              </span>
            </span>
            <div>
              <dt className="text-[13px] font-semibold text-dd-text">{strategy.name}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-dd-muted">{strategy.description}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Model prefixes select provider branding without changing chip health state. */
function ModelChip({ model }) {
  const provider = model.id.split("/", 1)[0];

  return (
    <span className="relative inline-flex" title={model.health === "warning" ? "Quota limited" : "Healthy"}>
      <StatusDot
        tone={model.health}
        className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2"
      />
      <ProviderLogo
        provider={provider}
        size={14}
        className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2"
      />
      <Chip label={model.id} size="sm" className="pl-10 font-mono" />
    </span>
  );
}

function ComboCard({ combo }) {
  const [strategy, setStrategy] = React.useState(combo.strategy);

  return (
    <Card padding={false} className={combo.featured ? "border-dd-accent" : ""}>
      <div className="flex items-start gap-3 border-b border-dd-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold text-dd-text">{combo.name}</h2>
            {combo.featured ? (
              <span
                className="material-symbols-outlined text-[16px] leading-none text-dd-accent"
                title="Primary combo"
              >
                hotel_class
              </span>
            ) : null}
          </div>
          <p className="dd-tnum mt-1 text-xs text-dd-muted">
            ctx {combo.context} · max {combo.maxOutput}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton icon="content_copy" label={`Copy ${combo.name}`} size="sm" />
          <IconButton icon="edit" label={`Edit ${combo.name}`} size="sm" />
          <IconButton
            icon="delete"
            label={`Delete ${combo.name}`}
            size="sm"
            className="hover:bg-dd-surface-2 hover:text-dd-danger"
          />
        </div>
      </div>

      <div className="flex min-h-16 flex-wrap content-start gap-2 px-5 py-4">
        {combo.models.map((model) => (
          <ModelChip key={model.id} model={model} />
        ))}
      </div>

      <div className="grid items-end gap-3 border-t border-dd-border-subtle bg-dd-surface-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <label className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-dd-muted">Strategy</span>
          <Select
            options={strategyOptions}
            value={strategy}
            onChange={setStrategy}
            size="sm"
            aria-label={`${combo.name} strategy`}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-dd-muted">Timeout</span>
          <div className="relative">
            <Input
              type="number"
              min="1"
              size="sm"
              defaultValue={combo.timeout}
              aria-label={`${combo.name} timeout in seconds`}
              className="dd-tnum pr-7 font-mono"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-dd-subtle">
              s
            </span>
          </div>
        </label>
      </div>
    </Card>
  );
}

/** Mocked combo management surface; shell-level page identity and actions come from its story decorator. */
export default function CombosPage({ combos = defaultCombos }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon="layers" title="Combos" subtitle="Model combos with fallback" />

      <StrategyGuide />
      {combos.length ? (
        <section aria-label="Model combos" className="grid gap-4 lg:grid-cols-2">
          {combos.map((combo) => (
            <ComboCard key={combo.id} combo={combo} />
          ))}
        </section>
      ) : (
        <Card>
          <EmptyState
            icon="layers"
            title="No combos yet"
            message="Create a combo to route requests across models with fallback and scoring strategies."
            action={{ label: "Create Combo", icon: "add", onClick: () => undefined }}
          />
        </Card>
      )}
    </div>
  );
}
