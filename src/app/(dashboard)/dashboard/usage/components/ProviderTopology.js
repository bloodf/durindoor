"use client";

import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Panel,
  ControlButton,
  useReactFlow,
  useStore,
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
  // Own keyboard disclosure explicitly: transformed graph nodes must reveal
  // their description on focus in WebKit as well as on pointer hover.
  const [focused, setFocused] = useState(false);
  return (
    <div
      className={`group relative ${PROVIDER_NODE_BASE} ${active ? PROVIDER_NODE_ACTIVE : PROVIDER_NODE_IDLE}`}
      style={{ minWidth: 160 }}
      {...getProviderNodeAccessibility(active, tooltipId)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
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
          className={`pointer-events-none absolute left-1/2 top-full z-50 mt-2 min-w-56 -translate-x-1/2 rounded-dd-lg border border-dd-border bg-dd-surface p-3 text-left text-xs text-dd-text shadow-dd-elevated transition-opacity group-hover:visible group-hover:opacity-100 ${focused ? "visible opacity-100" : "invisible opacity-0"}`}
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

/** Framing used by every fit-view call, so the button matches auto-fit. */
const FIT_OPTS = { padding: 0.2, duration: 200 };
/** Controls currently drops unknown props, so use its public primitives for a labeled root. */
function TopologyControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom);
  const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom);

  return (
    <Panel
      position="bottom-left"
      role="group"
      aria-label="Control Panel"
      className="react-flow__controls vertical react-flow-controls-custom"
      data-testid="rf__controls"
    >
      <ControlButton className="react-flow__controls-zoomin !size-11" onClick={() => zoomIn()} title="Zoom In" aria-label="Zoom In" disabled={maxZoomReached}>
        <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" /></svg>
      </ControlButton>
      <ControlButton className="react-flow__controls-zoomout !size-11" onClick={() => zoomOut()} title="Zoom Out" aria-label="Zoom Out" disabled={minZoomReached}>
        <svg aria-hidden="true" viewBox="0 0 32 5"><path d="M0 0h32v4.2H0z" /></svg>
      </ControlButton>
      <ControlButton className="react-flow__controls-fitview !size-11" onClick={() => fitView(FIT_OPTS)} title="Fit View" aria-label="Fit View">
        <svg aria-hidden="true" viewBox="0 0 32 30"><path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" /></svg>
      </ControlButton>
    </Panel>
  );
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
  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame = null;
    let width;
    let height;
    // ResizeObserver delivers after layout. fitView writes the graph transform,
    // so defer it out of that delivery cycle and coalesce resize notifications.
    // ReactFlow's fitView prop owns initialization after node measurement; no
    // competing initialization timers should outlive a replaced graph.
    const ro = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width;
      const nextHeight = entry.contentRect.height;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (width > 0 && height > 0) rfInstance.current?.fitView(FIT_OPTS);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [providersKey]);

  return (
    <div ref={containerRef} className="h-[320px] w-full min-w-0 rounded-dd-lg border border-dd-border bg-dd-surface [&_.react-flow__edges]:pointer-events-none sm:h-[480px]">
      {providers.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[13px] text-dd-muted">No providers connected</div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={FIT_OPTS}
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
          edgesFocusable={false}
          nodesFocusable={false}
        >
          <TopologyControls />
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
