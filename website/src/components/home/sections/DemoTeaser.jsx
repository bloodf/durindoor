"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import Icon from "../ui/Icon.jsx";
import { Magnetic, SectionHeader } from "../ui/primitives.jsx";

const NAV = ["Endpoint", "Providers", "Combos", "Usage", "Quota", "MCP gateway", "CLI tools"];
const STATS = [
  { label: "Requests today", value: "12,480", delta: "+8.2%" },
  { label: "Tokens", value: "18.2M", delta: "+3.1%" },
  { label: "Est. cost", value: "$41.70", delta: "−12%" },
  { label: "Fallbacks saved", value: "312", delta: "combo" },
];
const BARS = [38, 52, 44, 68, 58, 74, 62, 88, 70, 94, 80, 66, 72, 90];
const LOGS = [
  { model: "coding-default", provider: "gemini", status: "200", ms: "690 ms", note: "fallback 1" },
  { model: "cc/claude-sonnet", provider: "claude", status: "200", ms: "538 ms", note: "stream" },
  { model: "openai/gpt-4.1", provider: "openai", status: "200", ms: "412 ms", note: "stream" },
  { model: "daily-coder", provider: "openrouter", status: "429", ms: "96 ms", note: "retried" },
];

function MockDashboard() {
  return (
    <div className="mock" aria-hidden="true">
      <aside className="mock-side">
        <div className="mock-brand"><span className="mock-brand-dot" />DurinDoor</div>
        {NAV.map((item, i) => (
          <div key={item} className={`mock-nav ${i === 3 ? "is-active" : ""}`}>{item}</div>
        ))}
      </aside>
      <div className="mock-main">
        <div className="mock-head">
          <div>
            <p className="mock-kicker">Usage</p>
            <p className="mock-h">Last 14 days</p>
          </div>
          <span className="mock-pill">live</span>
        </div>
        <div className="mock-stats">
          {STATS.map((s) => (
            <div key={s.label} className="mock-stat">
              <p className="mock-stat-label">{s.label}</p>
              <p className="mock-stat-value">{s.value}</p>
              <p className="mock-stat-delta">{s.delta}</p>
            </div>
          ))}
        </div>
        <div className="mock-chart">
          {BARS.map((h, i) => (
            <span key={i} className="mock-bar" style={{ "--h": `${h}%`, "--i": i }} />
          ))}
        </div>
        <div className="mock-logs">
          {LOGS.map((log) => (
            <div key={log.model} className="mock-log">
              <img src={`/home/providers/${log.provider}.png`} alt="" width="18" height="18" loading="lazy" />
              <span className="mock-log-model">{log.model}</span>
              <span className={`mock-log-status ${log.status === "200" ? "is-ok" : "is-warn"}`}>{log.status}</span>
              <span className="mock-log-ms">{log.ms}</span>
              <span className="mock-log-note">{log.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DemoTeaser() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);

  return (
    <section id="demo" className="section section-demo" aria-labelledby="demo-title">
      <div className="container">
        <SectionHeader
          eyebrow="Live demo"
          title={<span id="demo-title">Walk through the dashboard, no install</span>}
          lead="The demo runs the real DurinDoor interface against mocked data, so you can click every page before you run it yourself."
        />
        <div className="demo-stage" ref={ref}>
          <motion.div className="window" style={{ rotateX, scale }}>
            <div className="window-bar">
              <span className="dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="window-url">localhost:20128/dashboard/usage</span>
            </div>
            <MockDashboard />
          </motion.div>
          <div className="demo-glow" aria-hidden="true" />
        </div>
        <div className="demo-cta">
          <Magnetic internal href="/dashboard" className="btn btn-primary btn-large">
            <Icon name="play" size={16} />
            Open the live demo
          </Magnetic>
          <p className="demo-note">Mocked data. Nothing leaves your browser.</p>
        </div>
      </div>
    </section>
  );
}
