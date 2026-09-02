import React, { useMemo, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

globalThis.React ??= React;

import Drawer from "@/shared/ui/components/Drawer.jsx";
import KeyValue from "@/shared/ui/components/KeyValue.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import TimelinePage from "./TimelinePage.jsx";
import { detailEvents, timelineRows } from "./mockData.js";

function InteractiveTimeline({
  initialStatus = "all",
  initialModel = "",
  rows = timelineRows,
  loading = false,
}) {
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState(initialStatus);
  const [model, setModel] = useState(initialModel);
  const [live, setLive] = useState(true);

  const filteredRows = useMemo(() => {
    const modelQuery = model.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (provider === "all" || row.provider === provider) &&
        (status === "all" || row.status === status) &&
        (!modelQuery || row.model.toLowerCase().includes(modelQuery)),
    );
  }, [model, provider, rows, status]);

  return (
    <TimelinePage
      rows={filteredRows}
      provider={provider}
      status={status}
      model={model}
      live={live}
      onProviderChange={setProvider}
      onStatusChange={setStatus}
      onModelChange={setModel}
      onLiveChange={setLive}
      loading={loading}
    />
  );
}

function DetailDrawerStory() {
  const [open, setOpen] = useState(true);
  const row = timelineRows[0];

  return (
    <>
      <TimelinePage rows={timelineRows} />
      <Drawer open={open} title={`${row.provider} · ${row.model}`} width={480} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-5">
          <div className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3">
            <KeyValue
              items={[
                { label: "Status", value: row.status },
                { label: "Events", value: row.events, mono: true },
                { label: "Fallbacks", value: row.fallbacks, mono: true },
                { label: "Duration", value: `${row.duration.toLocaleString()} ms`, mono: true },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-dd-muted">Connection</span>
            <code className="break-all rounded-dd bg-dd-surface-2 px-3 py-2 font-mono text-xs text-dd-text">
              {row.connection}
            </code>
          </div>

          <section className="flex flex-col gap-2" aria-labelledby="timeline-events-title">
            <h3 id="timeline-events-title" className="text-sm font-semibold text-dd-text">
              Redacted events
            </h3>
            <ol className="overflow-hidden rounded-dd border border-dd-border-subtle">
              {detailEvents.map((event) => (
                <li
                  key={event.time}
                  className="grid grid-cols-[4rem_1fr] gap-3 border-b border-dd-border-subtle px-3 py-2.5 last:border-b-0"
                >
                  <span className="font-mono text-xs text-dd-subtle dd-tnum">{event.time}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-dd-text">{event.label}</span>
                    <span className="truncate font-mono text-xs text-dd-muted">{event.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </Drawer>
    </>
  );
}

const meta = {
  title: "Durin DS/Pages/Timeline",
  component: TimelinePage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/timeline",
      title: "Timeline",
      subtitle: "Live redacted proxy hops and client frames",
      icon: "timeline",
    }),
  ],
};

export default meta;

export const Default = {
  render: () => <InteractiveTimeline />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rowsSelect = canvas.getByRole("combobox", { name: "Rows per page" });

    await expect(rowsSelect).toHaveValue("25");
    await userEvent.selectOptions(rowsSelect, "10");
    await expect(rowsSelect).toHaveValue("10");
    await expect(canvas.getByText("Showing 1 to 10 of 37 results")).toBeInTheDocument();
  },
};

export const FilteredToAborted = {
  render: () => <InteractiveTimeline initialStatus="aborted" />,
};

export const Loading = {
  render: () => <InteractiveTimeline loading />,
};

export const Empty = {
  render: () => <InteractiveTimeline initialModel="no-such-model" />,
};

export const WithDetailDrawer = {
  render: () => <DetailDrawerStory />,
};
