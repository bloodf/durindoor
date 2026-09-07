"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";

const REGISTRY_ENDPOINT = "/api/cli-tools/cowork-mcp-registry";
const TOOLS_ENDPOINT = "/api/cli-tools/cowork-mcp-tools";
const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "authless", label: "Authless" },
  { value: "oauth", label: "OAuth" },
];

export default function McpMarketplaceModal({ isOpen, onClose, onAdd, addedNames = [] }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState(null);
  const [expandedUrl, setExpandedUrl] = useState(null);
  const [toolsCache, setToolsCache] = useState({});
  const [toolsLoading, setToolsLoading] = useState({});
  const [toolSelection, setToolSelection] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    if (servers.length > 0) return;
    setLoading(true);
    setError(null);
    fetch(REGISTRY_ENDPOINT)
      .then((response) => response.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setServers(data.servers || []);
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [isOpen, servers.length]);

  const addedSet = useMemo(() => new Set(addedNames), [addedNames]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return servers.filter((server) => {
      if (filter === "authless" && server.oauth) return false;
      if (filter === "oauth" && !server.oauth) return false;
      if (!query) return true;
      return (
        (server.title || "").toLowerCase().includes(query) ||
        (server.description || "").toLowerCase().includes(query) ||
        (server.name || "").toLowerCase().includes(query)
      );
    });
  }, [servers, search, filter]);

  const fetchTools = async (server) => {
    if (toolsCache[server.url]) return;
    setToolsLoading((prev) => ({ ...prev, [server.url]: true }));
    try {
      const response = await fetch(TOOLS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: server.url }),
      });
      const data = await response.json();
      const tools = data.tools || [];
      const fallback = Array.isArray(server.toolNames) ? server.toolNames : [];
      const toolNames = tools.length > 0 ? tools.map((tool) => tool.name) : fallback;
      setToolsCache((prev) => ({ ...prev, [server.url]: { tools, requiresAuth: !!data.requiresAuth, error: data.error } }));
      setToolSelection((prev) => ({ ...prev, [server.url]: Object.fromEntries(toolNames.map((name) => [name, true])) }));
    } catch (toolError) {
      setToolsCache((prev) => ({ ...prev, [server.url]: { tools: [], error: toolError.message } }));
    } finally {
      setToolsLoading((prev) => ({ ...prev, [server.url]: false }));
    }
  };

  const expandServer = (server) => {
    if (expandedUrl === server.url) {
      setExpandedUrl(null);
      return;
    }
    setExpandedUrl(server.url);
    fetchTools(server);
  };

  const toggleTool = (url, tool) => {
    setToolSelection((prev) => ({ ...prev, [url]: { ...prev[url], [tool]: !prev[url]?.[tool] } }));
  };

  const setAllTools = (url, value) => {
    const sel = toolSelection[url] || {};
    setToolSelection((prev) => ({ ...prev, [url]: Object.fromEntries(Object.keys(sel).map((name) => [name, value])) }));
  };

  const confirmAdd = (server) => {
    const sel = toolSelection[server.url] || {};
    const enabled = Object.keys(sel).filter((name) => sel[name]);
    onAdd?.({
      name: server.slug || server.name,
      title: server.title,
      description: server.description,
      url: server.url,
      transport: server.transport,
      oauth: server.oauth,
      toolNames: enabled,
    });
    setExpandedUrl(null);
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="Browse MCP Marketplace" size="lg" footer={<>
      <span className="text-xs text-dd-muted dd-tnum">{filtered.length} of {servers.length} servers</span>
      <Button variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
    </>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or description" size="sm" icon="search" className="min-w-0 flex-1" aria-label="Search marketplace" />
          <Select value={filter} onChange={(value) => setFilter(value)} options={FILTER_OPTIONS} size="sm" className="w-40" aria-label="Filter by auth" />
        </div>
        {error ? <div role="alert" className="flex items-start gap-2 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-xs text-dd-danger"><span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">error</span><span>{error}</span></div> : null}
        {loading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-6 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] leading-none">progress_activity</span><span>Loading registry…</span></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="extension_off" title="No servers match filter" message="Try a different search or clear the auth filter to see all entries." />
        ) : (
          <ul className="flex max-h-[60vh] min-w-0 flex-col gap-1 overflow-y-auto" aria-label="MCP servers">
            {filtered.map((server) => {
              const added = addedSet.has(server.slug || server.name);
              const expanded = expandedUrl === server.url;
              const cache = toolsCache[server.url];
              const isLoadingTools = toolsLoading[server.url];
              const sel = toolSelection[server.url] || {};
              const toolKeys = Object.keys(sel);
              const selectedCount = Object.values(sel).filter(Boolean).length;
              return (
                <li key={server.url} className={["rounded-dd-lg border bg-dd-surface transition-colors", expanded ? "border-dd-border" : "border-dd-border-subtle hover:border-dd-border"].join(" ")}>
                  <div className="flex items-start gap-3 px-3 py-2">
                    {server.iconUrl ? <img src={server.iconUrl} alt="" className="size-7 shrink-0 rounded-dd object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span aria-hidden="true" className="size-7 shrink-0 rounded-dd bg-dd-surface-2" />}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-dd-text">{server.title}</span>
                        <Badge tone={server.oauth ? "warning" : "success"} size="sm">{server.oauth ? "OAuth" : "Authless"}</Badge>
                        {Number(server.toolCount) > 0 ? <span className="text-xs text-dd-muted dd-tnum">{server.toolCount} tools</span> : null}
                      </div>
                      {server.description ? <p className="line-clamp-2 text-xs text-dd-muted">{server.description}</p> : null}
                    </div>
                    <Button
                      variant={added ? "secondary" : expanded ? "ghost" : "primary"}
                      size="sm"
                      onClick={() => (added ? null : expandServer(server))}
                      disabled={added}
                      icon={added ? "check" : "add"}
                    >{added ? "Added" : expanded ? "Cancel" : "Add"}</Button>
                  </div>
                  {expanded ? (
                    <div className="flex flex-col gap-2 border-t border-dd-border-subtle bg-dd-surface-2 px-3 py-2">
                      {isLoadingTools ? (
                        <div className="flex items-center gap-2 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[14px] leading-none">progress_activity</span><span>Probing server for tools…</span></div>
                      ) : null}
                      {!isLoadingTools && cache?.requiresAuth ? (
                        <p role="status" className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-2 py-1 text-xs text-dd-warning"><span aria-hidden="true" className="material-symbols-outlined mr-1 align-middle text-[14px] leading-none">lock</span>OAuth required. Add now and authenticate after Apply; tool list will be discovered after first connect.</p>
                      ) : null}
                      {!isLoadingTools && cache?.error && !cache?.requiresAuth ? (
                        <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-2 py-1 text-xs text-dd-danger">Probe failed: {cache.error}</p>
                      ) : null}
                      {!isLoadingTools && toolKeys.length === 0 && !cache?.requiresAuth && !cache?.error ? <p className="text-xs text-dd-muted">No tools advertised by server.</p> : null}
                      {!isLoadingTools && toolKeys.length > 0 ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-dd-muted dd-tnum">{selectedCount}/{toolKeys.length} tools enabled</span>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setAllTools(server.url, true)}>All</Button>
                              <Button variant="ghost" size="sm" onClick={() => setAllTools(server.url, false)}>None</Button>
                            </div>
                          </div>
                          <ul className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                            {toolKeys.map((tool) => <li key={tool}><Checkbox checked={!!sel[tool]} onChange={() => toggleTool(server.url, tool)} label={tool} /></li>)}
                          </ul>
                        </>
                      ) : null}
                      <div className="flex justify-end">
                        <Button variant="primary" size="sm" icon="check" onClick={() => confirmAdd(server)}>Confirm add</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {expandedUrl ? <Chip label={`Tools from ${filtered.find((item) => item.url === expandedUrl)?.title || "server"}`} onRemove={() => setExpandedUrl(null)} size="sm" /> : null}
        </div>
      </div>
    </Modal>
  );
}
