import { useState } from "react";

import { Badge } from "./Badge.jsx";
import DataTable from "./DataTable.jsx";
import Input from "./Input.jsx";
import Select from "./Select.jsx";

const timeline = [
  {
    id: "req_01J8X4P8K2",
    started: "Sep 1, 09:42:18",
    status: "Completed",
    tone: "success",
    provider: "OpenAI",
    model: "gpt-5",
    events: 14,
    fallbacks: 0,
    duration: 842,
  },
  {
    id: "req_01J8X4NQZ7",
    started: "Sep 1, 09:41:52",
    status: "Fallback",
    tone: "warning",
    provider: "Anthropic",
    model: "claude-sonnet-4.5",
    events: 11,
    fallbacks: 1,
    duration: 1264,
  },
  {
    id: "req_01J8X4MFJD",
    started: "Sep 1, 09:41:31",
    status: "Completed",
    tone: "success",
    provider: "Google",
    model: "gemini-2.5-pro",
    events: 9,
    fallbacks: 0,
    duration: 719,
  },
  {
    id: "req_01J8X4KZ3D",
    started: "Sep 1, 09:40:58",
    status: "Queued",
    tone: "neutral",
    provider: "OpenAI",
    model: "gpt-5-mini",
    events: 3,
    fallbacks: 0,
    duration: 184,
  },
  {
    id: "req_01J8X4JHRM",
    started: "Sep 1, 09:40:22",
    status: "Completed",
    tone: "success",
    provider: "Anthropic",
    model: "claude-haiku-4.5",
    events: 8,
    fallbacks: 0,
    duration: 493,
  },
  {
    id: "req_01J8X4H0VT",
    started: "Sep 1, 09:39:47",
    status: "Fallback",
    tone: "warning",
    provider: "Google",
    model: "gemini-2.5-flash",
    events: 12,
    fallbacks: 2,
    duration: 1108,
  },
  {
    id: "req_01J8X4FJKC",
    started: "Sep 1, 09:39:09",
    status: "Completed",
    tone: "success",
    provider: "OpenAI",
    model: "gpt-4.1",
    events: 10,
    fallbacks: 0,
    duration: 667,
  },
  {
    id: "req_01J8X4E2W9",
    started: "Sep 1, 09:38:36",
    status: "Queued",
    tone: "neutral",
    provider: "Anthropic",
    model: "claude-sonnet-4.5",
    events: 2,
    fallbacks: 0,
    duration: 96,
  },
];

const timelineRows = Array.from({ length: 64 }, (_, index) => {
  const sample = timeline[index % timeline.length];
  return {
    ...sample,
    id: `${sample.id}_${String(index + 1).padStart(2, "0")}`,
  };
});

const columns = [
  { key: "started", label: "Started", mono: true, width: "11rem" },
  {
    key: "status",
    label: "Status",
    width: "7rem",
    render: (row) => (
      <Badge tone={row.tone} size="sm">
        {row.status}
      </Badge>
    ),
  },
  { key: "provider", label: "Provider" },
  { key: "model", label: "Model", mono: true },
  { key: "events", label: "Events", align: "right", width: "5rem" },
  { key: "fallbacks", label: "Fallbacks", align: "right", width: "6rem" },
  { key: "duration", label: "ms", align: "right", width: "4rem" },
];

function TimelineFilterBar() {
  const [provider, setProvider] = useState("all");

  return (
    <>
      <Input size="sm" icon="search" placeholder="Search requests…" aria-label="Search requests" />
      <Select
        size="sm"
        className="w-40"
        value={provider}
        onChange={setProvider}
        aria-label="Filter by provider"
        options={[
          { value: "all", label: "All providers" },
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" },
          { value: "google", label: "Google" },
        ]}
      />
    </>
  );
}

function ProxyTimelineTable() {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const pageCount = rowsPerPage === "all" ? 1 : Math.ceil(timelineRows.length / rowsPerPage);
  const startIndex = rowsPerPage === "all" ? 0 : (page - 1) * rowsPerPage;
  const visibleRows =
    rowsPerPage === "all" ? timelineRows : timelineRows.slice(startIndex, startIndex + rowsPerPage);
  const firstRow = timelineRows.length === 0 ? 0 : startIndex + 1;
  const lastRow = Math.min(startIndex + visibleRows.length, timelineRows.length);

  return (
    <div className="w-full max-w-7xl">
      <DataTable
        columns={columns}
        rows={visibleRows}
        keyFn={(row) => row.id}
        density="compact"
        filterBar={<TimelineFilterBar />}
        pagination={{
          page,
          pageCount,
          rowsPerPage,
          rowsLabel: `Showing ${firstRow} to ${lastRow} of ${timelineRows.length} requests`,
          onPage: setPage,
          onRowsPerPageChange: (value) => {
            setRowsPerPage(value);
            setPage(1);
          },
        }}
      />
    </div>
  );
}

const meta = {
  title: "Durin DS/Data/DataTable",
  component: DataTable,
  parameters: { layout: "padded" },
};

export default meta;

export const ProxyTimeline = {
  render: () => <ProxyTimelineTable />,
};

export const Empty = {
  render: () => (
    <div className="w-full max-w-7xl">
      <DataTable
        columns={columns}
        rows={[]}
        keyFn={(row) => row.id}
        density="compact"
        filterBar={<TimelineFilterBar />}
        emptyState={{
          icon: "history",
          title: "No proxy requests",
          message: "Requests matching these filters will appear here.",
        }}
      />
    </div>
  ),
};

export const Loading = {
  render: () => (
    <div className="w-full max-w-7xl">
      <DataTable
        columns={columns}
        rows={timeline}
        keyFn={(row) => row.id}
        density="compact"
        filterBar={<TimelineFilterBar />}
        loading
      />
    </div>
  ),
};
