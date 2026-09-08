"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CardSkeleton } from "@/shared/components";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { MitmLinkCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

export default function CLIToolsPageClient({ machineId }) {
  const [loading, setLoading] = useState(true);
  const [toolStatuses, setToolStatuses] = useState({});
  const [loadError, setLoadError] = useState(null);
  const mountedRef = useRef(true);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(ALL_STATUSES_URL);
      if (!res.ok) throw new Error("Could not load tool statuses.");
      const data = await res.json();
      if (mountedRef.current) setToolStatuses(data);
    } catch (error) {
      console.log("Error fetching tool statuses:", error);
      if (mountedRef.current) setLoadError(error?.message || "Could not load tool statuses.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatuses();
    return () => { mountedRef.current = false; };
  }, [loadStatuses]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
      </div>
    );
  }

  const regularTools = Object.entries(CLI_TOOLS);
  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 text-[13px]">
      <PageHeader icon="code" title="CLI Tools" subtitle="Configure CLI tools" />

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-dd-danger">
          <span>{loadError}</span>
          <Button variant="secondary" size="sm" onClick={loadStatuses}>Retry</Button>
        </div>
      ) : null}

      <section aria-label="CLI tools" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {regularTools.map(([toolId, tool]) => <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />)}
      </section>

      <section aria-labelledby="mitm-tools-title" className="flex flex-col gap-3">
        <div>
          <h2 id="mitm-tools-title" className="text-sm font-semibold text-dd-text">MITM Tools</h2>
          <p className="mt-0.5 text-xs text-dd-muted">Configure local traffic interception tools.</p>
        </div>
        <div aria-label="MITM tools" role="region" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mitmTools.map(([toolId, tool]) => <MitmLinkCard key={toolId} tool={tool} />)}
        </div>
      </section>
    </div>
  );
}
