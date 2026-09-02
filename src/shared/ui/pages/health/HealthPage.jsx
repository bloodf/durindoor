import { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";

import { connections, headroomProxy, healthStats } from "./mockData.js";

const stateBadgeTone = {
  Healthy: "success",
  Degraded: "warning",
  Down: "danger",
  Blocked: "danger",
  Unknown: "neutral",
};

/** Provider cells retain wire IDs while resolving shared logo assets and fallbacks. */
const columns = [
  {
    key: "connection",
    label: "Connection",
    width: "20%",
    render: (row) => <span className="font-medium text-dd-text">{row.connection}</span>,
  },
  {
    key: "provider",
    label: "Provider",
    width: "14%",
    render: (row) => (
      <span className="flex items-center gap-2 font-mono">
        <ProviderLogo provider={row.logoProvider ?? row.provider} size={18} />
        {row.provider}
      </span>
    ),
  },
  {
    key: "state",
    label: "State",
    width: "21%",
    render: (row) => (
      <div className="flex items-center gap-2">
        <StatusDot tone={row.tone} />
        <Badge tone={stateBadgeTone[row.state]} size="sm">
          {row.state}
        </Badge>
      </div>
    ),
  },
  { key: "status", label: "Status", mono: true, align: "right", width: "10%" },
  { key: "latency", label: "Latency", mono: true, align: "right", width: "12%" },
  {
    key: "error",
    label: "Error",
    render: (row) => (
      <span className={row.error === "HTTP 404" ? "text-dd-danger" : "text-dd-muted"}>{row.error}</span>
    ),
  },
];

export default function HealthPage() {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const total = connections.length;
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(total / rowsPerPage));
  const visibleRows = rowsPerPage === "all"
    ? connections
    : connections.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const firstRow = total === 0 ? 0 : (page - 1) * (rowsPerPage === "all" ? total : rowsPerPage) + 1;
  const lastRow = total === 0 ? 0 : firstRow + visibleRows.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="health_and_safety"
        title="Provider Health"
        subtitle="Reachability of your configured provider connections"
        actions={<Button variant="ghost" icon="refresh">Refresh</Button>}
      />

      <section aria-label="Connection health summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {healthStats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>

      <Card padding={false}>
        <CardHeader icon="compress" title="Headroom compression proxy" subtitle="Local proxy availability" />
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <span className="font-mono text-[13px] text-dd-text">{headroomProxy.url}</span>
          <StatusDot tone={headroomProxy.tone} label={headroomProxy.state} pulse />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="connections-title">
        <div>
          <h2 id="connections-title" className="text-base font-semibold text-dd-text">Connections</h2>
          <p className="text-[13px] text-dd-muted">Latest reachability check for each configured connection</p>
        </div>
        <DataTable
          columns={columns}
          rows={visibleRows}
          keyFn={(row) => row.id}
          density="compact"
          pagination={{
            page,
            pageCount,
            total,
            rowsLabel: `Showing ${firstRow} to ${lastRow} of ${total} results`,
            onPage: setPage,
            rowsPerPage,
            onRowsPerPageChange: (value) => {
              setRowsPerPage(value);
              setPage(1);
            },
          }}
        />
      </section>
    </div>
  );
}
