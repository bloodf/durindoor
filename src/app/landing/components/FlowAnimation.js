"use client";

import { useEffect, useState } from "react";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";

const CLI_TOOLS = [{ id: "claude", name: "Claude Code" }, { id: "codex", name: "OpenAI Codex" }, { id: "cline", name: "Cline" }, { id: "cursor", name: "Cursor" }];
const PROVIDERS = [{ id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }, { id: "gemini", name: "Gemini" }, { id: "copilot", name: "GitHub Copilot" }];

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setActiveFlow((prev) => (prev + 1) % PROVIDERS.length), 2000);
    return () => clearInterval(interval);
  }, []);

  return <>
    {/* Directional desktop diagram is LTR-specific; mirror by hiding it under RTL and showing the card grid fallback instead. */}
    <div className="relative mt-16 hidden h-[360px] w-full max-w-4xl animate-[dd-float_6s_ease-in-out_infinite] items-center justify-center md:ltr:flex md:rtl:hidden motion-reduce:animate-none">
      <div className="group relative z-20 flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-full border-2 border-dd-accent bg-dd-surface shadow-dd-elevated transition-transform duration-500 hover:scale-105"><span aria-hidden="true" className="material-symbols-outlined text-4xl text-dd-accent">hub</span><span className="text-[10px] font-bold uppercase tracking-widest text-dd-text">DurinDoor</span><span aria-hidden="true" className="absolute inset-0 rounded-full border border-dd-accent/30 opacity-20 animate-ping" /></div>
      <div className="absolute start-0 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-7">{CLI_TOOLS.map((tool) => <div key={tool.id} className="group flex items-center gap-3 opacity-70 transition-opacity hover:opacity-100"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-dd border border-dd-border bg-dd-surface p-2 transition-all group-hover:scale-105 hover:border-dd-accent"><ProviderLogo provider={tool.id} size={48} className="rounded-dd object-contain" /><span className="sr-only">{tool.name}</span></div></div>)}</div>
      <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" viewBox="0 0 800 360" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {[50, 140, 210, 300].map((y) => <path key={`in-${y}`} d={`M 60 ${y} C 250 ${y}, 250 180, 360 180`} fill="none" stroke="var(--dd-accent-2)" strokeWidth="2" strokeDasharray="5,5" className="animate-[dd-dash_2s_linear_infinite]" opacity="0.5" />)}
        {[50, 130, 230, 310].map((y, idx) => <path key={`out-${idx}`} d={`M 440 180 C 550 180, 550 ${y}, 740 ${y}`} fill="none" stroke={activeFlow === idx ? "var(--dd-accent)" : "var(--dd-border)"} strokeWidth={activeFlow === idx ? "3" : "2"} className={activeFlow === idx ? "animate-pulse" : ""} />)}
      </svg>
      <div className="absolute end-0 top-0 bottom-0 z-10 flex flex-col justify-between py-6">{PROVIDERS.map((provider, idx) => <div key={provider.id} title={provider.name} className={`flex min-w-[140px] items-center justify-center gap-2 rounded-dd border px-4 py-2 text-xs font-bold shadow-dd-elevated transition-all cursor-help ${activeFlow === idx ? "border-dd-accent bg-dd-surface text-dd-accent scale-110" : "border-dd-border bg-dd-surface text-dd-text hover:scale-110"}`}><ProviderLogo provider={provider.id} size={20} className="rounded-dd" /><span>{provider.name}</span></div>)}</div>
    </div>
    <div className="mt-8 w-full rounded-dd-lg border border-dd-border bg-dd-surface p-5 md:hidden">
      <div className="mb-4 flex items-center gap-2"><span aria-hidden="true" className="material-symbols-outlined text-dd-accent">hub</span><p className="font-semibold text-dd-text">DurinDoor routes every request</p></div>
      <div className="grid grid-cols-2 gap-3">{[...CLI_TOOLS, ...PROVIDERS].map((item) => <div key={item.id} className="flex items-center gap-2 rounded-dd bg-dd-surface-2 p-3 text-[13px] text-dd-text"><ProviderLogo provider={item.id} size={24} /><span>{item.name}</span></div>)}</div>
    </div>
    {/* RTL fallback keeps the same logical card grid as mobile but always visible at md+ where the directional graph is hidden. */}
    <div className="mt-8 hidden w-full max-w-4xl rounded-dd-lg border border-dd-border bg-dd-surface p-5 md:rtl:flex md:ltr:hidden">
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="col-span-full flex items-center gap-2"><span aria-hidden="true" className="material-symbols-outlined text-dd-accent">hub</span><p className="font-semibold text-dd-text">DurinDoor routes every request</p></div>
        {CLI_TOOLS.map((tool) => <div key={`cli-${tool.id}`} className="flex items-center gap-2 rounded-dd bg-dd-surface-2 p-3 text-[13px] text-dd-text"><ProviderLogo provider={tool.id} size={24} /><span>{tool.name}</span></div>)}
        {PROVIDERS.map((provider) => <div key={`p-${provider.id}`} className="flex items-center gap-2 rounded-dd bg-dd-surface-2 p-3 text-[13px] text-dd-text"><ProviderLogo provider={provider.id} size={24} /><span>{provider.name}</span></div>)}
      </div>
    </div>
  </>;
}
