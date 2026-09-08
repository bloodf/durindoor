"use client";

import { useRouter } from "next/navigation";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

export default function HeroSection() {
  const router = useRouter();
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden px-6 pb-20 pt-32">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-dd-accent-soft blur-[120px]" />
      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-8 text-center bg-dd-surface">
        <Badge tone="accent" icon="auto_awesome" size="md" className="px-3 py-1"><span className="font-medium">v1.0 is now live</span></Badge>
        <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-dd-text md:text-7xl">
          One endpoint for <br />
          <span className="text-dd-accent">all AI providers</span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg font-light text-dd-muted md:text-xl">
          AI endpoint proxy with web dashboard — a JavaScript port of CLIProxyAPI. Works with Claude Code, OpenAI Codex, Cline, RooCode, and other CLI tools.
        </p>
        <div className="flex w-full flex-wrap items-center justify-center gap-4">
          <Button variant="primary" size="md" icon="rocket_launch" className="h-12 px-8 text-base" onClick={() => router.push("/dashboard")}>Get started</Button>
          <a
            href="https://github.com/bloodf/durindoor"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-8 text-base font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">code</span>
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
