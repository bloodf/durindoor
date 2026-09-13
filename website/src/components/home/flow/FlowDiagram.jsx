import { CLIENTS, FLOW_PROVIDERS } from "../data.js";

// Client tools → the door → providers. Two static layouts (wide + tall) share
// one renderer; packets ride the paths with SMIL animateMotion and are hidden
// by CSS for reduced-motion users.

const WIDE = {
  viewBox: "0 0 1000 520",
  door: { x: 500, y: 260, in: [438, 260], out: [562, 260] },
  clients: CLIENTS.map((c, i) => ({ ...c, x: 110, y: 110 + i * 100 })),
  providers: FLOW_PROVIDERS.map((p, i) => ({ ...p, x: 890, y: 60 + i * 80 })),
  clientPath: (n, d) => `M ${n.x + 62} ${n.y} C ${n.x + 200} ${n.y}, ${d.in[0] - 140} ${d.in[1]}, ${d.in[0]} ${d.in[1]}`,
  providerPath: (d, n) => `M ${d.out[0]} ${d.out[1]} C ${d.out[0] + 140} ${d.out[1]}, ${n.x - 200} ${n.y}, ${n.x - 62} ${n.y}`,
  labels: true,
};

const TALL = {
  viewBox: "0 0 400 720",
  door: { x: 200, y: 360, in: [200, 298], out: [200, 422] },
  clients: CLIENTS.map((c, i) => ({ ...c, x: 62 + i * 92, y: 70 })),
  providers: FLOW_PROVIDERS.map((p, i) => ({ ...p, x: 42 + (i % 3) * 158, y: 600 + Math.floor(i / 3) * 76 })),
  clientPath: (n, d) => `M ${n.x} ${n.y + 32} C ${n.x} ${n.y + 140}, ${d.in[0]} ${d.in[1] - 110}, ${d.in[0]} ${d.in[1]}`,
  providerPath: (d, n) => `M ${d.out[0]} ${d.out[1]} C ${d.out[0]} ${d.out[1] + 90}, ${n.x} ${n.y - 110}, ${n.x} ${n.y - 32}`,
  labels: false,
};

function Node({ node, labels, prefix }) {
  const w = labels ? 124 : 56;
  return (
    <g className="flow-node" transform={`translate(${node.x - w / 2} ${node.y - 26})`}>
      <rect width={w} height="52" rx="14" className="flow-node-box" />
      <rect x="10" y="10" width="32" height="32" rx="8" className="flow-node-chip" />
      <image href={node.logo} x="14" y="14" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
      {labels ? (
        <text x="50" y="31" className="flow-node-label">{node.name}</text>
      ) : (
        <title>{`${prefix}: ${node.name}`}</title>
      )}
    </g>
  );
}

function Door({ door, labels }) {
  const { x, y } = door;
  return (
    <g className="flow-door" transform={`translate(${x} ${y})`}>
      <circle r="120" className="flow-door-halo" />
      <path d="M -52 62 V -12 A 52 52 0 0 1 52 -12 V 62 Z" className="flow-door-stone" />
      <path d="M -34 62 V -8 A 34 34 0 0 1 34 -8 V 62" className="flow-door-arch" />
      <path d="M 0 -42 V 62" className="flow-door-seam" />
      <circle cy="20" r="11" className="flow-door-ring" />
      <text y={labels ? 96 : 92} textAnchor="middle" className="flow-door-label">DurinDoor</text>
      <text y={labels ? 116 : 110} textAnchor="middle" className="flow-door-sub">localhost:20128/v1</text>
    </g>
  );
}

function Packets({ id, index, tone, reverse = false }) {
  const begin = `${(index * 0.7) % 3.2}s`;
  return (
    <g className="flow-packets">
      <circle r="4.5" className={`flow-packet is-${tone}`}>
        <animateMotion dur="3.2s" begin={begin} repeatCount="indefinite" keyPoints={reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear">
          <mpath href={`#${id}`} />
        </animateMotion>
      </circle>
    </g>
  );
}

function Layout({ layout, className, name }) {
  const { door } = layout;
  return (
    <svg className={`flow-svg ${className}`} viewBox={layout.viewBox} role="img" aria-labelledby={`${name}-title`}>
      <title id={`${name}-title`}>
        Requests from Claude Code, Codex, Cursor and Cline pass through DurinDoor on localhost:20128 and are routed to
        OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek or Ollama.
      </title>
      <defs>
        <linearGradient id={`${name}-wire`} x1="0" x2="1">
          <stop offset="0" stopColor="#10E882" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="#10E882" stopOpacity="0.55" />
          <stop offset="1" stopColor="#D4AF37" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {layout.clients.map((n, i) => {
        const id = `${name}-c${i}`;
        return (
          <g key={id}>
            <path id={id} d={layout.clientPath(n, door)} className="flow-wire" stroke={`url(#${name}-wire)`} />
            <Packets id={id} index={i} tone="request" />
          </g>
        );
      })}
      {layout.providers.map((n, i) => {
        const id = `${name}-p${i}`;
        return (
          <g key={id}>
            <path id={id} d={layout.providerPath(door, n)} className="flow-wire" stroke={`url(#${name}-wire)`} />
            <Packets id={id} index={i + 2} tone="request" />
            <Packets id={id} index={i + 4} tone="response" reverse />
          </g>
        );
      })}
      <Door door={door} labels={layout.labels} />
      {layout.clients.map((n) => (
        <Node key={n.name} node={n} labels={layout.labels} prefix="Client" />
      ))}
      {layout.providers.map((n) => (
        <Node key={n.name} node={n} labels={layout.labels} prefix="Provider" />
      ))}
    </svg>
  );
}

export default function FlowDiagram() {
  return (
    <div className="flow-diagram">
      <Layout layout={WIDE} className="is-wide" name="flow-wide" />
      <Layout layout={TALL} className="is-tall" name="flow-tall" />
    </div>
  );
}
