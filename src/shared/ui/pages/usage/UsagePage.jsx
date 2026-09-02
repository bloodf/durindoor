import { Fragment, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import RangeSelector, { rangeLabel } from "@/shared/ui/components/RangeSelector.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import {
  apiKeyUsage,
  modelUsage,
  providerSpend,
  recentRequests,
  usageSeries,
} from "./mockData.js";
const providerOptions = [
  { value: "all", label: "All providers" },
  ...["anthropic", "codex", "google", "openai"].map((provider) => ({
    value: provider,
    label: (
      <span className="flex items-center gap-2 capitalize">
        <ProviderLogo provider={provider} size={16} />
        {provider}
      </span>
    ),
  })),
];

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "ok", label: "Ok" },
  { value: "aborted", label: "Aborted" },
  { value: "error", label: "Error" },
];
const viewOptions = [
  { value: "overview", label: "Overview" },
  { value: "details", label: "Details" },
];

const rangePresetMultipliers = {
  "1d": 1 / 7,
  "7d": 1,
  "15d": 15 / 7,
  "1m": 30 / 7,
  "3m": 90 / 7,
  "6m": 180 / 7,
  "12m": 365 / 7,
  all: 730 / 7,
};

function rangeMultiplier(range) {
  if (range.preset !== "custom") {
    return rangePresetMultipliers[range.preset] ?? 1;
  }
  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  const toMs = Date.parse(`${range.to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 1;
  const days = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
  return Math.max(1 / 7, days / 7);
}

function formatNumber(value) {
  return Math.round(value).toLocaleString();
}

function parseNumber(value) {
  return Number(String(value).replace(/[^\d.]/g, ""));
}

function formatTokens(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return formatNumber(value);
}

function formatCost(value) {
  return `$${value.toFixed(2)}`;
}

function scaleRecentRequests(multiplier) {
  const count = Math.max(1, Math.min(recentRequests.length, Math.ceil(recentRequests.length * multiplier)));
  return recentRequests.slice(0, count).map((request) => ({
    ...request,
    input: formatTokens(parseNumber(request.input) * (request.input.endsWith("K") ? 1000 : 1) * multiplier),
    output: formatTokens(parseNumber(request.output) * (request.output.endsWith("K") ? 1000 : 1) * multiplier),
  }));
}

function scaleModelUsage(multiplier) {
  return modelUsage.map((model) => ({
    ...model,
    requests: formatNumber(parseNumber(model.requests) * multiplier),
    inputCost: formatCost(parseNumber(model.inputCost) * multiplier),
    cachedCost: formatCost(parseNumber(model.cachedCost) * multiplier),
    outputCost: formatCost(parseNumber(model.outputCost) * multiplier),
    totalCost: formatCost(parseNumber(model.totalCost) * multiplier),
  }));
}

function scaleApiKeyUsage(multiplier) {
  return apiKeyUsage.map((apiKey) => ({
    ...apiKey,
    requests: formatNumber(parseNumber(apiKey.requests) * multiplier),
    inputTokens: formatNumber(parseNumber(apiKey.inputTokens) * multiplier),
    outputTokens: formatNumber(parseNumber(apiKey.outputTokens) * multiplier),
    cost: formatCost(parseNumber(apiKey.cost) * multiplier),
    models: apiKey.models.map((model) => ({
      ...model,
      requests: formatNumber(parseNumber(model.requests) * multiplier),
      tokens: formatNumber(parseNumber(model.tokens) * multiplier),
      cost: formatCost(parseNumber(model.cost) * multiplier),
    })),
  }));
}

function scaleProviderSpend(multiplier) {
  return providerSpend.map((provider) => ({
    ...provider,
    requests: formatNumber(parseNumber(provider.requests) * multiplier),
    tokens: formatTokens(parseNumber(provider.tokens) * 1000000 * multiplier),
    value: provider.value * multiplier,
  }));
}

function usageDataForRange(range) {
  const multiplier = rangeMultiplier(range);
  return {
    stats: [
      { icon: "query_stats", label: "Total requests", value: formatNumber(2990 * multiplier) },
      {
        icon: "input",
        label: "Total input tokens",
        value: formatNumber(376992313 * multiplier),
        tone: "accent",
      },
      { icon: "cached", label: "Cached tokens", value: formatNumber(337862277 * multiplier) },
      { icon: "output", label: "Output tokens", value: formatNumber(1273572 * multiplier) },
      {
        icon: "payments",
        label: "Est. cost",
        value: `~$${(431.62 * multiplier).toFixed(2)}`,
        tone: "warning",
        hint: "Estimated, not actual billing",
      },
    ],
    series: usageSeries.map((point) => ({
      ...point,
      tokens: Math.round(point.tokens * multiplier),
      cost: Number((point.cost * multiplier).toFixed(2)),
    })),
    recentRequests: scaleRecentRequests(multiplier),
    modelUsage: scaleModelUsage(multiplier),
    apiKeyUsage: scaleApiKeyUsage(multiplier),
    providerSpend: scaleProviderSpend(multiplier),
  };
}

const statusTones = { ok: "success", aborted: "warning", error: "danger" };

const requestColumns = [
  { key: "model", label: "Model", mono: true },
  {
    key: "provider",
    label: "Provider",
    render: (row) => (
      <span className="flex items-center gap-2">
        <ProviderLogo provider={row.provider} size={16} />
        <span>{row.provider}</span>
      </span>
    ),
  },
  {
    key: "input",
    label: "In tokens",
    align: "right",
    render: (row) => (
      <span className="font-mono text-xs text-dd-text dd-tnum">
        <span className="text-dd-subtle">↓</span> {row.input}
      </span>
    ),
  },
  {
    key: "output",
    label: "Out tokens",
    align: "right",
    render: (row) => (
      <span className="font-mono text-xs text-dd-text dd-tnum">
        <span className="text-dd-subtle">↑</span> {row.output}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    render: (row) => (
      <Badge tone={statusTones[row.status]} size="sm" className="capitalize">
        {row.status}
      </Badge>
    ),
  },
  { key: "time", label: "When", mono: true },
];

const modelColumns = [
  { key: "model", label: "Model", mono: true },
  { key: "provider", label: "Provider" },
  { key: "requests", label: "Requests", mono: true, align: "right" },
  {
    key: "lastUsed",
    label: "Last used",
    mono: true,
    render: (row) => <span title={row.lastUsed}>{row.lastUsed}</span>,
  },
  { key: "inputCost", label: "Input cost", mono: true, align: "right" },
  { key: "cachedCost", label: "Cached", mono: true, align: "right" },
  { key: "outputCost", label: "Output", mono: true, align: "right" },
  {
    key: "totalCost",
    label: "Total cost",
    align: "right",
    render: (row) => (
      <span className="font-mono font-semibold text-dd-text dd-tnum">{row.totalCost}</span>
    ),
  },
];

function compactNumber(value) {
  if (value >= 1000000) return `${Math.round(value / 1000000)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function UsageChart({ data, label }) {
  return (
    <Card padding={false} className="min-w-0">
      <CardHeader
        icon="area_chart"
        title="Tokens & cost over time"
        subtitle={`Usage throughout ${label.toLowerCase()}`}
      />
      <CardContent className="h-[310px] pb-3 pl-2 pr-4 pt-5">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickMargin={10}
            />
            <YAxis
              yAxisId="Left"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickFormatter={compactNumber}
              width={52}
            />
            <YAxis
              yAxisId="Right"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickFormatter={(value) => `$${value}`}
              width={46}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--dd-border)" }}
              contentStyle={{
                background: "var(--dd-surface-3)",
                border: "1px solid var(--dd-border)",
                borderRadius: "var(--dd-radius)",
                color: "var(--dd-text)",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                name === "Cost" ? `$${Number(value).toFixed(2)}` : Number(value).toLocaleString(),
                name,
              ]}
            />
            <Legend wrapperStyle={{ color: "var(--dd-text-muted)", fontSize: 12 }} />
            <Line
              yAxisId="Left"
              type="monotone"
              dataKey="tokens"
              name="Tokens"
              stroke="var(--dd-accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ fill: "var(--dd-accent)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
            />
            <Line
              yAxisId="Right"
              type="monotone"
              dataKey="cost"
              name="Cost"
              stroke="var(--dd-accent-2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ fill: "var(--dd-accent-2)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function RecentRequests({ requestRows, initialProvider, initialStatus, initialModel }) {
  const [provider, setProvider] = useState(initialProvider);
  const [status, setStatus] = useState(initialStatus);
  const [model, setModel] = useState(initialModel);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const modelQuery = model.trim().toLowerCase();
  const rows = requestRows.filter(
    (request) =>
      (provider === "all" || request.provider === provider) &&
      (status === "all" || request.status === status) &&
      request.model.toLowerCase().includes(modelQuery),
  );
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const firstVisibleRow = rows.length === 0 ? 0 : rowsPerPage === "all" ? 1 : (currentPage - 1) * rowsPerPage + 1;
  const lastVisibleRow = rowsPerPage === "all" ? rows.length : Math.min(currentPage * rowsPerPage, rows.length);
  const visibleRows = rowsPerPage === "all"
    ? rows
    : rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  return (
    <section aria-labelledby="recent-requests-title" className="space-y-3">
      <div>
        <h2 id="recent-requests-title" className="text-sm font-semibold text-dd-text">
          Recent requests
        </h2>
        <p className="mt-0.5 text-xs text-dd-muted">Latest gateway activity</p>
      </div>
      <DataTable
        columns={requestColumns}
        rows={visibleRows}
        keyFn={(row) => row.id}
        density="compact"
        filterBar={
          <>
            <Select
              size="sm"
              className="w-40"
              value={provider}
              onChange={(value) => {
                setProvider(value);
                setPage(1);
              }}
              options={providerOptions}
              aria-label="Filter recent requests by provider"
            />
            <Select
              size="sm"
              className="w-36"
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={statusOptions}
              aria-label="Filter recent requests by status"
            />
            <Input
              size="sm"
              icon="search"
              className="w-56"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setPage(1);
              }}
              placeholder="Filter by model…"
              aria-label="Filter recent requests by model"
            />
          </>
        }
        emptyState={{
          icon: "filter_alt_off",
          title: "No recent requests",
          message: "No requests match the selected filters.",
        }}
        pagination={{
          page: currentPage,
          pageCount,
          total: rows.length,
          rowsLabel: `Showing ${firstVisibleRow} to ${lastVisibleRow} of ${rows.length} results`,
          onPage: setPage,
          rowsPerPage,
          onRowsPerPageChange: (value) => {
            setRowsPerPage(value);
            setPage(1);
          },
        }}
      />
    </section>
  );
}

/** Expandable credential totals with model-level attribution. */
function ApiKeyUsage({ initialExpandedKey, rows }) {
  const [expandedKeys, setExpandedKeys] = useState(
    initialExpandedKey ? [initialExpandedKey] : [],
  );

  const toggleKey = (keyId) => {
    setExpandedKeys((keys) =>
      keys.includes(keyId) ? keys.filter((id) => id !== keyId) : [...keys, keyId],
    );
  };

  return (
    <section aria-labelledby="usage-by-api-key-title" className="space-y-3">
      <div>
        <h2 id="usage-by-api-key-title" className="text-sm font-semibold text-dd-text">
          Usage by API key
        </h2>
        <p className="mt-0.5 text-xs text-dd-muted">Client credential usage for selected range</p>
      </div>
      <div className="overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px] text-dd-text">
            <thead className="bg-dd-surface-2 text-[11px] font-medium uppercase tracking-wide text-dd-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Key</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Status</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Requests</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Input tokens</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Output tokens</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Cost</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Last used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((apiKey) => {
                const expanded = expandedKeys.includes(apiKey.id);
                return (
                  <Fragment key={apiKey.id}>
                    <tr className="border-t border-dd-border-subtle transition-colors hover:bg-dd-surface-2">
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left text-dd-text"
                          aria-expanded={expanded}
                          aria-controls={`api-key-${apiKey.id}-models`}
                          onClick={() => toggleKey(apiKey.id)}
                        >
                          <span
                            aria-hidden="true"
                            className={`material-symbols-outlined text-[18px] leading-none text-dd-muted transition-transform ${expanded ? "rotate-90" : ""}`}
                          >
                            chevron_right
                          </span>
                          <span>
                            <span className="block font-medium">{apiKey.name}</span>
                            <span className="block font-mono text-xs text-dd-muted">{apiKey.maskedKey}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-1.5"><Badge tone="success" size="sm">Active</Badge></td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs dd-tnum">{apiKey.requests}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs dd-tnum">{apiKey.inputTokens}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs dd-tnum">{apiKey.outputTokens}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold dd-tnum">{apiKey.cost}</td>
                      <td className="px-3 py-1.5 font-mono text-xs dd-tnum">{apiKey.lastUsed}</td>
                    </tr>
                    {expanded ? (
                      <tr id={`api-key-${apiKey.id}-models`} className="border-t border-dd-border-subtle bg-dd-surface-2">
                        <td colSpan={7} className="px-10 py-3">
                          <div className="overflow-hidden rounded-dd border border-dd-border-subtle bg-dd-surface">
                            <table className="w-full text-left text-xs text-dd-text">
                              <thead className="text-[11px] uppercase tracking-wide text-dd-muted">
                                <tr>
                                  <th scope="col" className="px-3 py-2 font-medium">Model</th>
                                  <th scope="col" className="px-3 py-2 font-medium">Provider</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">Requests</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">Tokens</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {apiKey.models.map((model) => (
                                  <tr key={model.model} className="border-t border-dd-border-subtle">
                                    <td className="px-3 py-2 font-mono">{model.model}</td>
                                    <td className="px-3 py-2">
                                      <span className="flex items-center gap-2">
                                        <ProviderLogo provider={model.provider} size={16} />
                                        <span className="font-mono">{model.provider}</span>
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono dd-tnum">{model.requests}</td>
                                    <td className="px-3 py-2 text-right font-mono dd-tnum">{model.tokens}</td>
                                    <td className="px-3 py-2 text-right font-mono font-semibold dd-tnum">{model.cost}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ProviderSpend({ rows }) {
  return (
    <Card padding={false}>
      <CardHeader icon="dns" title="Usage by provider" subtitle="Estimated for selected range" />
      <CardContent className="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-dd-text">
            <thead className="bg-dd-surface-2 text-[11px] uppercase tracking-wide text-dd-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Provider</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Requests</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Tokens</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
                <th scope="col" className="px-3 py-2 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((provider) => (
                <tr key={provider.provider} className="border-t border-dd-border-subtle">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      <ProviderLogo provider={provider.provider} size={20} />
                      {provider.provider}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono dd-tnum">{provider.requests}</td>
                  <td className="px-3 py-2 text-right font-mono dd-tnum">{provider.tokens}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold dd-tnum">${provider.value.toFixed(2)}</td>
                  <td className="w-24 px-3 py-2">
                    <span className="mb-1 block font-mono text-dd-muted dd-tnum">{provider.share}%</span>
                    <span className="block h-1.5 overflow-hidden rounded-dd bg-dd-surface-3">
                      <span
                        className="block h-full rounded-dd bg-dd-accent"
                        style={{ width: `${provider.share}%` }}
                        role="meter"
                        aria-label={`${provider.provider} usage share`}
                        aria-valuenow={provider.share}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function UsagePage({
  initialProvider = "all",
  initialStatus = "all",
  initialModel = "",
  initialExpandedKey,
  initialRange = { preset: "7d" },
}) {
  const [view, setView] = useState("overview");
  const [range, setRange] = useState(initialRange);
  const [resetGeneration, setResetGeneration] = useState(0);
  const { stats, series, recentRequests: rangedRequests, modelUsage: rangedModels, apiKeyUsage: rangedApiKeys, providerSpend: rangedProviders } = usageDataForRange(range);
  const [modelFilter, setModelFilter] = useState("");
  const [modelPage, setModelPage] = useState(1);
  const [modelRowsPerPage, setModelRowsPerPage] = useState(25);
  const filteredModels = rangedModels.filter((row) =>
    row.model.toLowerCase().includes(modelFilter.trim().toLowerCase()),
  );
  const modelPageCount = modelRowsPerPage === "all"
    ? 1
    : Math.max(1, Math.ceil(filteredModels.length / modelRowsPerPage));
  const currentModelPage = Math.min(modelPage, modelPageCount);
  const firstVisibleModel = filteredModels.length === 0
    ? 0
    : modelRowsPerPage === "all"
      ? 1
      : (currentModelPage - 1) * modelRowsPerPage + 1;
  const lastVisibleModel = modelRowsPerPage === "all"
    ? filteredModels.length
    : Math.min(currentModelPage * modelRowsPerPage, filteredModels.length);
  const visibleModels = modelRowsPerPage === "all"
    ? filteredModels
    : filteredModels.slice(
        (currentModelPage - 1) * modelRowsPerPage,
        currentModelPage * modelRowsPerPage,
      );

  return (
    <div className="space-y-6">
      <PageHeader
        icon="monitoring"
        title="Usage & Analytics"
        subtitle="Monitor your API usage, token consumption, and request logs"
        actions={
          <>
            <SegmentedControl
              options={viewOptions}
              value={view}
              onChange={setView}
              size="sm"
              aria-label="Usage view"
            />
            <RangeSelector value={range} onChange={setRange} size="sm" />
            <Tooltip content="Reset usage filters" side="bottom">
              <IconButton
                icon="restart_alt"
                label="Reset usage filters"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setView("overview");
                  setRange({ preset: "7d" });
                  setModelFilter("");
                  setModelPage(1);
                  setModelRowsPerPage(25);
                  setResetGeneration((generation) => generation + 1);
                }}
              />
            </Tooltip>
          </>
        }
      />

      <section aria-label="Usage summary" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>

      <section aria-label="Usage trends" className="grid min-w-0 gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <UsageChart data={series} label={rangeLabel(range)} />
        </div>
        <ProviderSpend rows={rangedProviders} />
      </section>

      <ApiKeyUsage initialExpandedKey={initialExpandedKey} rows={rangedApiKeys} />
      <RecentRequests
        key={resetGeneration}
        requestRows={rangedRequests}
        initialProvider={resetGeneration ? "all" : initialProvider}
        initialStatus={resetGeneration ? "all" : initialStatus}
        initialModel={resetGeneration ? "" : initialModel}
      />

      <section aria-labelledby="usage-by-model-title" className="space-y-3">
        <div>
          <h2 id="usage-by-model-title" className="text-sm font-semibold text-dd-text">Usage by Model</h2>
          <p className="mt-0.5 text-xs text-dd-muted">Estimated token costs for selected range</p>
        </div>
        <DataTable
          columns={modelColumns}
          rows={visibleModels}
          keyFn={(row) => row.id}
          density="compact"
          filterBar={
            <Input
              size="sm"
              icon="search"
              className="w-56"
              value={modelFilter}
              onChange={(event) => {
                setModelFilter(event.target.value);
                setModelPage(1);
              }}
              placeholder="Filter by model…"
              aria-label="Filter usage by model"
            />
          }
          emptyState={{
            icon: "filter_alt_off",
            title: "No model usage",
            message: "No models match this search.",
          }}
          pagination={{
            page: currentModelPage,
            pageCount: modelPageCount,
            total: filteredModels.length,
            rowsLabel: `Showing ${firstVisibleModel} to ${lastVisibleModel} of ${filteredModels.length} results`,
            onPage: setModelPage,
            rowsPerPage: modelRowsPerPage,
            onRowsPerPageChange: (value) => {
              setModelRowsPerPage(value);
              setModelPage(1);
            },
          }}
        />
      </section>
    </div>
  );
}
