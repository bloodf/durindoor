"use client";

import { Card, CardContent } from "@/shared/ui/components/Card.jsx";

// Only show fields user actually cares about
const FIELD_SCHEMA = {
  mode:             { label: "Mode",       format: (v) => v },
  defaultModel:     { label: "Model",      format: (v) => v, mono: true },
  baseUrl:          { label: "Endpoint",   format: (v) => v, isLink: true, mono: true },
  costPerQuery:     { label: "Cost / call", format: (v) => v === 0 ? "Free" : `$${v.toFixed(4)}` },
  pricingUrl:       { label: "Pricing",    format: () => "View pricing", isLink: true },
  freeTier:         { label: "Free tier",  format: (v) => v },
  freeMonthlyQuota: { label: "Free quota",  format: (v) => v === 0 ? "—" : v >= 999999 ? "Unlimited" : `${v.toLocaleString()} / mo` },
  searchTypes:      { label: "Types",      format: (v) => v.join(", ") },
  formats:          { label: "Formats",    format: (v) => v.join(", ") },
  maxMaxResults:    { label: "Max results", format: (v) => v },
  maxCharacters:    { label: "Max chars",  format: (v) => v.toLocaleString() },
};

export default function ProviderInfoCard({ config, provider, title = "Provider Info" }) {
  if (!config) return null;

  const rows = Object.entries(FIELD_SCHEMA)
    .filter(([key]) => config[key] !== undefined && config[key] !== null && config[key] !== "")
    .map(([key, schema]) => ({
      key,
      label: schema.label,
      value: schema.format(config[key]),
      isLink: schema.isLink,
      mono: schema.mono,
      raw: config[key],
    }));

  const signupUrl = provider?.notice?.apiKeyUrl || provider?.website;
  const noticeText = provider?.notice?.text;

  return (
    <Card padding={false}>
      <div className="flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent" aria-hidden="true">
          <span className="material-symbols-outlined text-[18px] leading-none">info</span>
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-dd-text">{title}</h2>
        {signupUrl ? (
          <a
            href={signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 rounded-dd px-2 text-[13px] font-medium text-dd-accent outline-none hover:bg-dd-accent-soft focus-visible:shadow-dd-focus"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">open_in_new</span>
            Get API Key
          </a>
        ) : null}
      </div>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 items-center gap-3">
              <dt className="w-28 shrink-0 text-xs text-dd-muted">{row.label}</dt>
              <dd className="min-w-0 flex-1">
                {row.isLink ? (
                  <a href={row.raw} target="_blank" rel="noopener noreferrer" className={`block truncate text-[13px] text-dd-accent outline-none hover:underline focus-visible:rounded-dd focus-visible:shadow-dd-focus ${row.mono ? "font-mono dd-tnum" : ""}`}>
                    {row.value}
                  </a>
                ) : (
                  <span className={`block truncate text-[13px] text-dd-text ${row.mono ? "font-mono dd-tnum" : ""}`}>{row.value}</span>
                )}
              </dd>
            </div>
          ))}
          {noticeText ? <div className="flex min-w-0 items-start gap-3 sm:col-span-2"><dt className="w-28 shrink-0 pt-0.5 text-xs text-dd-muted">Notice</dt><dd className="text-[13px] leading-relaxed text-dd-text">{noticeText}</dd></div> : null}
        </dl>
      </CardContent>
    </Card>
  );
}
