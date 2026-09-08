"use client";

import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";
import Button from "@/shared/ui/components/Button.jsx";

export default function LandingPage() {
  const router = useRouter();
  return (
    <div className="relative overflow-x-hidden bg-dd-bg font-sans text-dd-text antialiased selection:bg-dd-accent selection:text-dd-on-accent">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-dd-bg"><div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,var(--dd-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--dd-border)_1px,transparent_1px)] [background-size:50px_50px]" /><div className="absolute left-1/4 top-0 h-[700px] w-[700px] rounded-full bg-dd-accent-soft blur-[130px] animate-[dd-blob_20s_ease-in-out_infinite] motion-reduce:animate-none" /><div className="absolute bottom-0 left-1/2 h-[650px] w-[650px] rounded-full bg-dd-accent-2-soft blur-[130px] animate-[dd-blob_25s_ease-in-out_4s_infinite] motion-reduce:animate-none" /></div>
      <div className="relative z-10"><Navigation /><main><div className="relative"><HeroSection /><div className="flex justify-center pb-20"><FlowAnimation /></div></div><GetStarted /><HowItWorks /><Features /><section className="relative overflow-hidden px-6 py-32"><div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-dd-accent-soft" /><div className="relative z-10 mx-auto max-w-4xl bg-dd-surface text-center"><h2 className="mb-6 text-4xl font-black text-dd-text md:text-5xl">Ready to simplify your AI infrastructure?</h2><p className="mx-auto mb-10 max-w-2xl text-xl text-dd-muted">Join developers streamlining AI integrations with DurinDoor. Open source and free to start.</p><div className="flex flex-col items-center justify-center gap-4 sm:flex-row"><Button variant="primary" className="w-full sm:w-auto" onClick={() => router.push("/dashboard")}>Start free</Button><a href="https://github.com/bloodf/durindoor#readme" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus sm:w-auto">Read documentation</a></div></div></section></main><Footer /></div>
      <style jsx global>{`@keyframes dd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes dd-dash{to{stroke-dashoffset:-20}}@keyframes dd-blob{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(30px,-50px) scale(1.1)}66%{transform:translate(-20px,20px) scale(.9)}}`}</style>
    </div>
  );
}
