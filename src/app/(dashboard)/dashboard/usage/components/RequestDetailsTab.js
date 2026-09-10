"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Drawer from "@/shared/ui/components/Drawer.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { isString } from "../../../../../shared/utils/typeChecks.js";

const REQUEST_DETAIL_ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100, "all"];
const REQUEST_DETAIL_MAX_PAGE_SIZE = 100;
const REQUEST_DETAIL_PAGE_SIZE = 20;

const PAYLOAD_STAGES = [
  { field: "request", label: "Client request" },
  { field: "providerRequest", label: "Provider request" },
  { field: "providerResponse", label: "Provider response" },
  { field: "response", label: "Client response" },
];

function PayloadMetadata({ detail }) {
  return (
    <CollapsibleSection title="Diagnostic payloads" defaultOpen={true} icon="privacy_tip">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-dd-text">Payloads intentionally redacted</p>
        <p className="text-[13px] text-dd-muted">Only presence, type, and byte length are retained for diagnostics.</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PAYLOAD_STAGES.map(({ field, label }) => {
            const metadata = detail?.[field] || {};
            return (
              <div key={field} className="rounded-dd bg-dd-surface-2 p-3 text-[13px]">
                <dt className="font-medium text-dd-text">{label}</dt>
                <dd className="text-dd-muted">
                  {metadata.present ? `${metadata.type || "payload"}${Number.isSafeInteger(metadata.bytes) ? ` · ${metadata.bytes} bytes` : ""}` : "Not present"}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </CollapsibleSection>
  );
}

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }
  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};
  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }
  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache,
  };
  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;
  const cached = cache[providerId];
  if (isString(cached)) return cached;
  if (cached?.name) return cached.name;
  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between p-3 text-left text-[13px] font-semibold text-dd-text outline-none transition-colors hover:bg-dd-surface-2 focus-visible:shadow-dd-focus"
      >
        <div className="flex items-center gap-2">
          {icon ? <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-muted">{icon}</span> : null}
          <span>{title}</span>
        </div>
        <span aria-hidden="true" className={cn("material-symbols-outlined text-[20px] text-dd-muted transition-transform", isOpen ? "rotate-90" : "")}>
          chevron_right
        </span>
      </button>
      {isOpen ? <div className="border-t border-dd-border-subtle p-4">{children}</div> : null}
    </div>
  );
}

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

function getCacheWriteTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getCacheReadTokens(tokens) {
  return tokens?.cache_read_input_tokens || tokens?.cached_tokens || tokens?.prompt_tokens_details?.cached_tokens || 0;
}

export default function RequestDetailsTab({ resetNonce = 0 } = {}) {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: REQUEST_DETAIL_PAGE_SIZE,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [observabilityEnabled, setObservabilityEnabled] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: "",
  });
  const inflightController = useRef(null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);
      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async (signal) => {
    setLoading(true);
    setFetchError(null);
    try {
      const buildParams = (page, pageSize) => {
        const params = new URLSearchParams({ page: page.toString(), pageSize: pageSize.toString() });
        if (filters.provider) params.append("provider", filters.provider);
        if (filters.startDate) params.append("startDate", filters.startDate);
        if (filters.endDate) params.append("endDate", filters.endDate);
        return params;
      };
      const requestPage = async (page, pageSize) => {
        const res = await fetch(`/api/usage/request-details?${buildParams(page, pageSize).toString()}`, { signal });
        if (!res.ok) throw new Error(`Request details failed: ${res.status}`);
        return res.json();
      };
      const allMode = pagination.pageSize === "all";
      const firstPage = allMode ? 1 : pagination.page;
      const firstPageSize = allMode ? REQUEST_DETAIL_MAX_PAGE_SIZE : pagination.pageSize;
      const data = await requestPage(firstPage, firstPageSize);
      if (signal.aborted) return;
      let rows = data.details || [];
      const totalItems = data.pagination?.totalItems ?? rows.length;
      const totalPages = data.pagination?.totalPages ?? 1;
      if (allMode) {
        for (let page = 2; page <= totalPages && rows.length < totalItems; page += 1) {
          const next = await requestPage(page, REQUEST_DETAIL_MAX_PAGE_SIZE);
          if (signal.aborted) return;
          const chunk = next.details || [];
          if (chunk.length === 0) break;
          rows = rows.concat(chunk);
        }
      }
      setDetails(rows);
      setPagination((prev) => ({
        ...prev,
        page: allMode ? 1 : (data.pagination?.page ?? prev.page),
        totalItems: data.pagination?.totalItems ?? prev.totalItems,
        totalPages: allMode ? 1 : totalPages,
      }));
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("Failed to fetch request details:", error);
        setFetchError(error.message || "Failed to fetch request details");
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data && !controller.signal.aborted) setObservabilityEnabled(data.enableObservability === true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (inflightController.current) inflightController.current.abort();
    const controller = new AbortController();
    inflightController.current = controller;
    fetchDetails(controller.signal);
    return () => controller.abort();
  }, [fetchDetails, resetNonce]);

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    const size = newPageSize === "all"
      ? "all"
      : Math.min(REQUEST_DETAIL_MAX_PAGE_SIZE, Math.max(1, Number(newPageSize) || REQUEST_DETAIL_PAGE_SIZE));
    setPagination((prev) => ({ ...prev, pageSize: size, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const providerOptions = [
    { value: "", label: "All providers" },
    ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
  ];

  const columns = [
    { key: "timestamp", label: "Timestamp", render: (row) => new Date(row.timestamp).toLocaleString() },
    { key: "model", label: "Model", mono: true, rowHeader: true, render: (row) => <span className="max-w-[260px] truncate font-mono text-[13px]" title={row.model}>{row.model}</span> },
    { key: "provider", label: "Provider", render: (row) => <span className="font-medium text-dd-text">{getProviderName(row.provider, providerNameCache)}</span> },
    { key: "inputTokens", label: "Input", align: "right", mono: true, render: (row) => getInputTokens(row.tokens).toLocaleString() },
    { key: "cached", label: "Cached", align: "right", mono: true, render: (row) => (getCachedTokens(row.tokens) > 0 ? getCachedTokens(row.tokens).toLocaleString() : "—") },
    { key: "cacheCreation", label: "Cache creation", align: "right", mono: true, render: (row) => (getCacheCreationTokens(row.tokens) > 0 ? getCacheCreationTokens(row.tokens).toLocaleString() : "—") },
    { key: "outputTokens", label: "Output", align: "right", mono: true, render: (row) => (row.tokens?.completion_tokens?.toLocaleString() || 0) },
    { key: "latency", label: "Latency", render: (row) => (
      <div className="flex flex-col gap-0.5 text-[12px] text-dd-muted">
        <span>TTFT: <span className="font-mono text-dd-text">{row.latency?.ttft || 0}ms</span></span>
        <span>Total: <span className="font-mono text-dd-text">{row.latency?.total || 0}ms</span></span>
      </div>
    ) },
    { key: "action", label: "Action", align: "center", render: (row) => (
      <Button variant="secondary" size="sm" onClick={() => handleViewDetail(row)}>Detail</Button>
    ) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6 text-[13px]">
      <Card padding={false}>
        <CardHeader icon="filter_list" title="Filters" subtitle="Refine the request log to a provider and time window" />
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select aria-label="Provider" options={providerOptions} value={filters.provider} onChange={(value) => setFilters((prev) => ({ ...prev, provider: value }))} />
            <Input label="Start date" type="datetime-local" value={filters.startDate} onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))} />
            <Input label="End date" type="datetime-local" value={filters.endDate} onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))} />
            <div className="flex flex-col items-stretch gap-2 sm:items-end sm:justify-end">
              <span className="hidden text-[13px] font-medium text-dd-text opacity-0 lg:block" aria-hidden="true">Clear</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleClearFilters} disabled={!filters.provider && !filters.startDate && !filters.endDate} className="flex-1">Clear filters</Button>
                <Button variant="secondary" icon="refresh" onClick={() => { if (inflightController.current) inflightController.current.abort(); const c = new AbortController(); inflightController.current = c; fetchDetails(c.signal); }} loading={loading} aria-label="Refresh">Refresh</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {fetchError ? (
        <div role="alert" className="rounded-dd-lg border border-dd-danger bg-dd-surface-2 px-3 py-2 text-[13px] text-dd-danger">
          {fetchError}
        </div>
      ) : null}

      <Card padding={false}>
        <DataTable
          framed={false}
          columns={columns}
          rows={details}
          keyFn={(row) => row.id}
          density="compact"
          loading={loading}
          emptyState={observabilityEnabled === false
            ? {
                icon: "visibility_off",
                title: "Request details logging is turned off",
                message: "Enable Observability in Settings to start recording every request here.",
                action: { label: "Open Settings", icon: "settings", href: "/dashboard/profile" },
              }
            : { icon: "inbox", title: "No request details found" }}
        />
        {!loading && details.length > 0 ? (
          <div className="border-t border-dd-border-subtle px-3 py-2">
            <Pagination
              page={pagination.page}
              pageCount={Math.max(1, pagination.totalPages)}
              total={pagination.totalItems}
              rowsPerPage={pagination.pageSize}
              rowsPerPageOptions={REQUEST_DETAIL_ROWS_PER_PAGE_OPTIONS}
              onPage={handlePageChange}
              onRowsPerPageChange={handlePageSizeChange}
            />
          </div>
        ) : null}
      </Card>

      <Drawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request details"
        width={520}
      >
        {selectedDetail ? (
          <div className="flex flex-col gap-4">
            <CollapsibleSection title="Summary" defaultOpen={true} icon="info">
              <div className="grid min-w-0 grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">ID</span>
                  <span className="break-all font-mono text-dd-text" data-i18n-skip="true">{selectedDetail.id}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Timestamp</span>
                  <span className="text-dd-text">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Provider</span>
                  <span className="font-medium text-dd-text">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Model</span>
                  <span className="font-mono text-dd-text" data-i18n-skip="true">{selectedDetail.model}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Status</span>
                  <Badge tone={selectedDetail.status === "success" ? "success" : "danger"} size="sm">{selectedDetail.status}</Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Latency</span>
                  <span className="font-mono text-dd-text">TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Input tokens</span>
                  <span className="font-mono text-dd-text">{getInputTokens(selectedDetail.tokens).toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Output tokens</span>
                  <span className="font-mono text-dd-text">{selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Cache creation</span>
                  <span className="font-mono text-dd-text">{getCacheWriteTokens(selectedDetail.tokens).toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-dd-muted">Cached</span>
                  <span className="font-mono text-dd-text">{getCacheReadTokens(selectedDetail.tokens).toLocaleString()}</span>
                </div>
              </div>
            </CollapsibleSection>

            {selectedDetail.pxpipe ? (
              <div className="rounded-dd-lg border border-dd-border bg-dd-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-muted">image</span>
                  <span className="text-[13px] font-semibold text-dd-text">PXPIPE</span>
                  <Badge tone={selectedDetail.pxpipe.applied ? "success" : "warning"} size="sm">{selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}</Badge>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-dd-muted">Original (est.)</span>
                      <span className="font-mono text-dd-text">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-dd-muted">Compressed (est.)</span>
                      <span className="font-mono text-dd-text">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-dd-muted">Saved</span>
                      <span className="font-mono text-dd-success">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-dd-muted">Images</span>
                      <span className="font-mono text-dd-text">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-dd-muted">
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            ) : null}

            <PayloadMetadata detail={selectedDetail} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
