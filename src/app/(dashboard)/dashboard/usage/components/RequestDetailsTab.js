"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { isString } from "../../../../../shared/utils/typeChecks.js";

const PAYLOAD_STAGES = [
  { field: "request", label: "Client request" },
  { field: "providerRequest", label: "Provider request" },
  { field: "providerResponse", label: "Provider response" },
  { field: "response", label: "Client response" }
];

function PayloadMetadata({ detail }) {
  return (
    <CollapsibleSection title="Diagnostic payloads" defaultOpen={true} icon="privacy_tip">
      <div className="space-y-3">
        <p className="text-sm font-medium text-text-main">Payloads intentionally redacted</p>
        <p className="text-sm text-text-muted">Only presence, type, and byte length are retained for diagnostics.</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PAYLOAD_STAGES.map(({ field, label }) => {
            const metadata = detail?.[field] || {};
            return (
              <div key={field} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/5">
                <dt className="font-medium text-text-main">{label}</dt>
                <dd className="text-text-muted">
                  {metadata.present ? `${metadata.type || "payload"}${Number.isSafeInteger(metadata.bytes) ? ` · ${metadata.bytes} bytes` : ""}` : "Not present"}
                </dd>
              </div>);
          })}
        </dl>
      </div>
    </CollapsibleSection>);
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
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (isString(cached)) {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors">
        
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <span className={cn(
          "material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200",
          isOpen ? "rotate-90" : ""
        )}>
          chevron_right
        </span>
      </button>
      
      {isOpen &&
      <div className="p-4 border-t border-black/5 dark:border-white/5">
          {children}
        </div>
      }
    </div>);

}

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

// Cache write tokens (Claude: cache_creation_input_tokens). Other providers
// don't report cache writes, so this is 0 for them.
function getCacheWriteTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

// Cache read/hit tokens (Claude: cache_read_input_tokens; OpenAI: cached_tokens).
function getCacheReadTokens(tokens) {
  return tokens?.cache_read_input_tokens ||
  tokens?.cached_tokens ||
  tokens?.prompt_tokens_details?.cached_tokens ||
  0;
}


export default function RequestDetailsTab({ resetNonce = 0 } = {}) {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: ""
  });

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

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString()
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails, resetNonce]);

  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="provider-filter" className="text-sm font-medium text-text-main">Provider</label>
            <select
              id="provider-filter"
              value={filters.provider}
              onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0 cursor-pointer"
              )}
              style={{ colorScheme: 'auto' }}>
              
              <option value="">All Providers</option>
              {providers.map((provider) =>
              <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              )}
            </select>
          </div>
          
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="start-date-filter" className="text-sm font-medium text-text-main">Start Date</label>
            <input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )} />
            
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="end-date-filter" className="text-sm font-medium text-text-main">End Date</label>
            <input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )} />
            
          </div>
          
          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">Clear</span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={handleClearFilters}
                disabled={!filters.provider && !filters.startDate && !filters.endDate}
                className="flex-1">
                
                Clear Filters
              </Button>
              {/* Manually re-fetch the current page of request details */}
              <Button
                variant="outline"
                icon="refresh"
                onClick={fetchDetails}
                loading={loading}
                aria-label="Refresh">
                
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left p-4 text-sm font-semibold text-text-main">Timestamp</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Provider</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Input Tokens</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Cached</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Cache Creation</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Output Tokens</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Latency</th>
                <th className="text-center p-4 text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ?
              <tr>
                  <td colSpan="7" className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading...
                    </div>
                  </td>
                </tr> :
              details.length === 0 ?
              <tr>
                  <td colSpan="7" className="p-8 text-center text-text-muted">
                    No request details found
                  </td>
                </tr> :

              details.map((detail, index) =>
              <tr
                key={`${detail.id}-${index}`}
                className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                
                    <td className="whitespace-nowrap p-4 text-sm text-text-main">
                      {new Date(detail.timestamp).toLocaleString()}
                    </td>
                    <td className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                      {detail.model}
                    </td>
                    <td className="max-w-[180px] truncate p-4 text-sm text-text-main">
                       <span className="font-medium">
                         {getProviderName(detail.provider, providerNameCache)}
                       </span>
                     </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getInputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {detail.tokens?.completion_tokens?.toLocaleString() || 0}
                    </td>
                    <td className="p-4 text-sm text-text-muted">
                      <div className="flex flex-col gap-0.5">
                        <div>TTFT: <span className="font-mono">{detail.latency?.ttft || 0}ms</span></div>
                        <div>Total: <span className="font-mono">{detail.latency?.total || 0}ms</span></div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewDetail(detail)}>
                    
                        Detail
                      </Button>
                    </td>
                  </tr>
              )
              }
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 &&
        <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange} />
          
          </div>
        }
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg">
        
        {selectedDetail &&
        <div className="space-y-4">
            <CollapsibleSection title="Summary" defaultOpen={true} icon="info">
              <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-text-muted">ID:</span>{" "}
                  <span className="break-all font-mono text-text-main" data-i18n-skip="true">{selectedDetail.id}</span>
                </div>
                <div>
                  <span className="text-text-muted">Timestamp:</span>{" "}
                  <span className="text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
                </div>
                <div>
                   <span className="text-text-muted">Provider:</span>{" "}
                   <span className="text-text-main font-medium">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
                 </div>
                <div>
                  <span className="text-text-muted">Model:</span>{" "}
                  <span className="text-text-main font-mono" data-i18n-skip="true">{selectedDetail.model}</span>
                </div>
                <div>
                  <span className="text-text-muted">Status:</span>{" "}
                  <span className={cn(
                  "font-medium",
                  selectedDetail.status === "success" ? "text-green-600" : "text-red-600"
                )}>
                    {selectedDetail.status}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Latency:</span>{" "}
                  <span className="text-text-main font-mono">
                    TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Input Tokens:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getInputTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Output Tokens:</span>{" "}
                  <span className="text-text-main font-mono">
                    {selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Cache Creation:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCacheWriteTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">Cached:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCacheReadTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              </div>
            </CollapsibleSection>

            {selectedDetail.pxpipe &&
          <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">image</span>
                  <span className="font-semibold text-sm text-text-main">PXPIPE</span>
                  <span className={cn(
                "text-xs px-2 py-0.5 rounded",
                selectedDetail.pxpipe.applied ?
                "bg-success/15 text-success" :
                "bg-warning/15 text-warning"
              )}>
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </span>
                </div>
                {selectedDetail.pxpipe.applied ?
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-text-muted block text-xs">Original (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Compressed (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Saved</span>
                      <span className="font-mono text-success">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Images</span>
                      <span className="font-mono">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div> :

            <p className="text-sm text-text-muted">
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
            }
              </div>
          }

            <PayloadMetadata detail={selectedDetail} />
          
          </div>
        }
      </Drawer>
    </div>);

}