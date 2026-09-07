"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { buildProviderActivity } from "./providerTopologyData.js";
import { getProviderNodeAccessibility } from "./providerNodeAccessibility.js";

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { name: providerId };
}

const PROVIDER_NODE_BASE = "flex items-center gap-2.5 rounded-dd-lg border-2 bg-dd-surface px-3.5 py-2 transition-colors";
const PROVIDER_NODE_ACTIVE = "border-dd-accent shadow-dd-focus";
const PROVIDER_NODE_IDLE = "border-dd-border";
export function ProviderNode({ data }) {
  const { label, active, activity = [], tooltipId } = data;
  return (
    <div
      className={`group relative ${PROVIDER_NODE_BASE} ${active ? PROVIDER_NODE_ACTIVE : PROVIDER_NODE_IDLE}`}
      style={{ minWidth: 160 }}
      {...getProviderNodeAccessibility(active, tooltipId)}
    >
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />
      <ProviderLogo provider={data.providerId} size={32} />
      <span className={`truncate text-[13px] font-medium ${active ? "text-dd-text" : "text-dd-muted"}`}>
        {label}
      </span>
      {active ? <span aria-hidden="true" className="ml-1 size-2 rounded-full bg-dd-success animate-pulse" /> : null}
      {active && activity.length > 0 ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-2 min-w-56 -translate-x-1/2 rounded-dd-lg border border-dd-border bg-dd-surface p-3 text-left text-xs text-dd-text opacity-0 shadow-dd-elevated transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          <p className="mb-2 font-semibold text-dd-text">{label} active calls</p>
          {activity.map((model) => (
            <div key={model.model} className="mt-2 first:mt-0">
              <p className="font-mono font-medium text-dd-text">{model.model}{model.count > 1 ? ` ×${model.count}` : ""}</p>
              <ul className="mt-1 space-y-0.5 text-dd-muted">
                {model.keys.map((key) => (
                  <li key={key.name}>{key.name}{key.count > 1 ? ` ×${key.count}` : ""}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

ProviderNode.propTypes = { data: PropTypes.object.isRequired };

function RouterNode({ data }) {
  return (
    <div className="flex items-center gap-2 rounded-dd-lg border-2 border-dd-accent bg-dd-accent-soft px-4 py-2.5 shadow-dd-elevated" style={{ minWidth: 150 }}>
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />
      <img src="/favicon.svg" alt="DurinDoor" className="size-6" />
      <span className="text-[13px] font-bold text-dd-text">DurinDoor</span>
      {data.activeCount > 0 ? (
        <span role="status" aria-label={`${data.activeCount} active`} className="ml-auto rounded-full bg-dd-accent px-1.5 py-0.5 text-[11px] font-bold text-dd-on-accent dd-tnum">
          {data.activeCount}
        </span>
      ) : null}
    </div>
  );
}

RouterNode.propTypes = { data: PropTypes.object.isRequired };

const nodeTypes = { provider: ProviderNode, router: RouterNode };

function buildLayout(providers, activeSet, lastSet, errorSet, activityByProvider = {}) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;
  const count = providers.length;
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55);

  const edgeStyle = (active, last, error) => {
    if (error) return { stroke: "var(--dd-danger)", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "var(--dd-accent)", strokeWidth: 2.5, opacity: 0.9 };
    if (last) return { stroke: "var(--dd-accent-2)", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--dd-border)", strokeWidth: 1, opacity: 0.3 };
  };

  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }],
      edges: [],
    };
  }
  const nodes = [
    { id: "router", type: "router", position: { x: -routerW / 2, y: -routerH / 2 }, data: { activeCount: activeSet.size }, draggable: false },
  ];
  const edges = [];

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const active = activeSet.has(p.provider?.toLowerCase());
    const last = !active && lastSet.has(p.provider?.toLowerCase());
    const error = !active && errorSet.has(p.provider?.toLowerCase());
    const nodeId = `provider-${p.provider}`;
    const data = {
      label: (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider,
      providerId: p.provider,
      active,
      activity: activityByProvider[p.provider?.toLowerCase()] || [],
      tooltipId: `provider-${p.provider}-active-keys`,
    };
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);
    let sourceHandle, targetHandle;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - 3 * Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }
    nodes.push({ id: nodeId, type: "provider", position: { x: cx - nodeW / 2, y: cy - nodeH / 2 }, data, draggable: false });
    edges.push({ id: `e-${nodeId}`, source: "router", sourceHandle, target: nodeId, targetHandle, animated: active, style: edgeStyle(active, last, error) });
  });

  return { nodes, edges };
}

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }) {
  const activeKey = useMemo(() => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","), [activeRequests]);
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";
  const activeSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);
  const activityByProvider = useMemo(() => buildProviderActivity(activeRequests), [activeRequests]);

  const { nodes, edges } = useMemo(() => buildLayout(providers, activeSet, lastSet, errorSet, activityByProvider), [providers, activeSet, lastSet, errorSet, activityByProvider]);

  const providersKey = useMemo(() => providers.map((p) => p.provider).sort().join(","), [providers]);
  const rfInstance = useRef(null);
  const containerRef = useRef(null);
  const fitOpts = { padding: 0.2, duration: 200 };
  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView(fitOpts), 50);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rfInstance.current) rfInstance.current.fitView(fitOpts);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current.fitView(fitOpts), 50);
      return () => clearTimeout(id);
    }
  }, [nodes.length]);

  return (
    <div ref={containerRef} className="h-[320px] w-full min-w-0 rounded-dd-lg border border-dd-border bg-dd-surface sm:h-[480px]">
      {providers.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[13px] text-dd-muted">No providers connected</div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(PropTypes.object),
  activeRequests: PropTypes.arrayOf(PropTypes.object),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
