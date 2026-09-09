import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

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
        caption="Proxy request timeline"
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

/** Rows sorted client-side; `render`ed header buttons drive `column.onSort`. */
function SortableEventsTable() {
  const [sortDirection, setSortDirection] = useState("descending");
  const sortedRows = [...timeline].sort((a, b) =>
    sortDirection === "descending" ? b.events - a.events : a.events - b.events,
  );
  const sortableColumns = columns.map((column) =>
    column.key === "events"
      ? {
          ...column,
          sortDirection,
          onSort: () => setSortDirection((prev) => (prev === "descending" ? "ascending" : "descending")),
        }
      : column,
  );

  return (
    <div className="w-full max-w-7xl">
      <DataTable caption="Requests sortable by event count" columns={sortableColumns} rows={sortedRows} keyFn={(row) => row.id} density="compact" />
    </div>
  );
}

/** Each row can expand to show its full event log inline. */
function ExpandableRequestsTable() {
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  return (
    <div className="w-full max-w-7xl">
      <DataTable
        caption="Requests with expandable detail"
        columns={columns.slice(0, 4)}
        rows={timeline.slice(0, 4)}
        keyFn={(row) => row.id}
        density="compact"
        getRowLabel={(row) => `request ${row.id}`}
        expandedRowKeys={expandedRowKeys}
        onExpandedRowKeysChange={setExpandedRowKeys}
        renderExpandedRow={(row) => (
          <p className="text-xs text-dd-muted">
            {row.events} events, {row.fallbacks} fallback(s), {row.duration}ms total.
          </p>
        )}
      />
    </div>
  );
}

/** Server owns `total`; the client only knows the current page slice. */
function ServerTotalTable() {
  const [page, setPage] = useState(1);
  const rowsPerPage = 8;
  const serverTotal = 2402;
  const pageCount = Math.ceil(serverTotal / rowsPerPage);

  return (
    <div className="w-full max-w-7xl">
      <DataTable
        caption="Server-paginated requests"
        columns={columns.slice(0, 5)}
        rows={timeline}
        keyFn={(row) => row.id}
        density="compact"
        pagination={{ page, pageCount, total: serverTotal, onPage: setPage }}
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("table", { name: "Proxy request timeline" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("row")).toHaveLength(11);
  },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No proxy requests")).toBeInTheDocument();
  },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true");
  },
};

export const Sortable = {
  render: () => <SortableEventsTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sortButton = canvas.getByRole("button", { name: /Events/ });
    await expect(canvas.getByRole("columnheader", { name: /Events/ })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(sortButton);
    await expect(canvas.getByRole("columnheader", { name: /Events/ })).toHaveAttribute("aria-sort", "ascending");
  },
};

export const Expandable = {
  render: () => <ExpandableRequestsTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: /Expand request req_01J8X4P8K2/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText(/14 events, 0 fallback/)).toBeInTheDocument();
  },
};

export const ServerOwnedTotal = {
  render: () => <ServerTotalTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("2,402 results")).toBeInTheDocument();
    await expect(canvas.getAllByRole("row")).toHaveLength(9);
  },
};

export const Narrow = {
  render: () => (
    <div className="w-60">
      <DataTable caption="Narrow viewport requests" columns={columns} rows={timeline.slice(0, 3)} keyFn={(row) => row.id} density="compact" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollRegion = canvas.getByRole("region", { name: "Narrow viewport requests rows" });
    await expect(scrollRegion.tabIndex).toBe(0);
  },
};

/** `framed={false}` drops the bordered wrapper for embedding inside another surface (e.g. a Card). */
export const Frameless = {
  render: () => (
    <div className="w-full max-w-7xl rounded-dd-lg border border-dd-border bg-dd-surface p-5">
      <DataTable caption="Embedded requests" columns={columns.slice(0, 4)} rows={timeline.slice(0, 3)} keyFn={(row) => row.id} density="compact" framed={false} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("table", { name: "Embedded requests" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("row")).toHaveLength(4);
  },
};
