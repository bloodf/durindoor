"use client";

import { Card } from "@/shared/ui/components/Card.jsx";

const TONE_CLASSES = {
  accent: "bg-dd-accent-soft text-dd-accent",
  "accent-2": "bg-dd-accent-2-soft text-dd-accent-2",
  success: "bg-dd-success/10 text-dd-success",
  warning: "bg-dd-warning/10 text-dd-warning",
  danger: "bg-dd-danger/10 text-dd-danger",
  info: "bg-dd-info/10 text-dd-info",
  neutral: "bg-dd-surface-2 text-dd-muted",
};

const FEATURES = [
  { icon: "link", title: "Unified endpoint", desc: "Access all providers via a single standard API URL.", tone: "accent" },
  { icon: "bolt", title: "Easy setup", desc: "Get up and running in minutes with npx command.", tone: "accent-2" },
  { icon: "shield_with_heart", title: "Model fallback", desc: "Automatically switch providers on failure or high latency.", tone: "danger" },
  { icon: "monitoring", title: "Usage tracking", desc: "Detailed analytics and cost monitoring across all models.", tone: "info" },
  { icon: "key", title: "OAuth & API keys", desc: "Securely manage credentials in one vault.", tone: "warning" },
  { icon: "cloud_sync", title: "Cloud sync", desc: "Sync your configurations across devices instantly.", tone: "info" },
  { icon: "terminal", title: "CLI support", desc: "Works with Claude Code, Codex, Cline, Cursor, and more.", tone: "success" },
  { icon: "dashboard", title: "Dashboard", desc: "Visual dashboard for real-time traffic analysis.", tone: "accent-2" },
];

export default function Features() {
  return (
    <section className="bg-dd-bg px-6 py-24" id="features">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <h2 className="mb-4 text-3xl font-bold text-dd-text md:text-4xl">Powerful features</h2>
          <p className="max-w-xl text-lg text-dd-muted">
            Everything you need to manage your AI infrastructure in one place, built for scale.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card key={feature.title} hover className="transition-transform duration-300 hover:-translate-y-0.5">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-dd ${TONE_CLASSES[feature.tone] ?? TONE_CLASSES.neutral}`}>
                <span aria-hidden="true" className="material-symbols-outlined">{feature.icon}</span>
              </div>
              <h3 className="mb-2 text-lg font-bold text-dd-text">{feature.title}</h3>
              <p className="text-[13px] leading-relaxed text-dd-muted">{feature.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
