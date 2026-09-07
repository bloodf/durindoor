"use client";

const STEPS = [
  { icon: "terminal", title: "1. CLI & SDKs", desc: "Your requests start from your favorite tools or our unified SDK. Just change the base URL.", align: "" },
  { icon: "hub", title: "2. DurinDoor Hub", desc: "Our engine analyzes the prompt, checks provider health, and routes for lowest latency or cost.", align: "md:items-center md:text-center", accent: true },
  { icon: "dashboard", title: "3. AI providers", desc: "The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.", align: "md:items-end md:text-end" },
];

export default function HowItWorks() {
  return (
    <section className="border-y border-dd-border bg-dd-bg-alt py-24" id="how-it-works">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16"><h2 className="mb-4 text-3xl font-bold text-dd-text md:text-4xl">How DurinDoor works</h2><p className="max-w-xl text-lg text-dd-muted">Data flows seamlessly from your application through our intelligent routing layer to the best provider for the job.</p></div>
        <div className="relative grid grid-cols-1 gap-8 md:grid-cols-3"><div aria-hidden="true" className="absolute left-[16%] right-[16%] top-12 hidden h-px -z-10 bg-dd-border md:block" />{STEPS.map((step) => <div key={step.title} className={`group relative flex flex-col gap-6 ${step.align}`}><div className={`z-10 mx-auto flex h-24 w-24 items-center justify-center rounded-dd-lg border shadow-dd-elevated transition-colors md:mx-0 ${step.accent ? "border-2 border-dd-accent bg-dd-surface" : "border-dd-border bg-dd-surface group-hover:border-dd-border-subtle"}`}><span aria-hidden="true" className={`material-symbols-outlined text-4xl ${step.accent ? "text-dd-accent animate-pulse" : "text-dd-muted"}`}>{step.icon}</span></div><div><h3 className={`mb-2 text-xl font-bold ${step.accent ? "text-dd-accent" : "text-dd-text"}`}>{step.title}</h3><p className="text-[13px] text-dd-muted">{step.desc}</p></div></div>)}</div>
      </div>
    </section>
  );
}
