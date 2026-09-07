"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-dd-border bg-dd-bg" aria-label="Main navigation">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button type="button" className="flex min-h-11 items-center gap-3 rounded-dd outline-none focus-visible:shadow-dd-focus" onClick={() => router.push("/")} aria-label="Navigate to home">
          <span className="flex size-9 items-center justify-center rounded-dd bg-dd-accent text-dd-on-accent"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">hub</span></span>
          <span className="text-xl font-semibold tracking-tight text-dd-text">DurinDoor</span>
        </button>
        <div className="hidden items-center gap-7 md:flex">
          <a className="inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus" href="#features">Features</a>
          <a className="inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus" href="#how-it-works">How it works</a>
          <a className="inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus" href="https://github.com/bloodf/durindoor#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="inline-flex min-h-11 items-center gap-1 rounded-dd px-2 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus" href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer">GitHub <span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span></a>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="primary" className="hidden sm:inline-flex" onClick={() => router.push("/dashboard")}>Get started</Button>
          <IconButton icon={mobileMenuOpen ? "close" : "menu"} label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"} className="md:hidden" onClick={() => setMobileMenuOpen((open) => !open)} />
        </div>
      </div>
      {mobileMenuOpen ? (
        <div className="border-t border-dd-border bg-dd-surface px-4 py-4 md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-2">
            <a className="rounded-dd px-3 py-3 text-[13px] font-medium text-dd-text outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus" href="#features" onClick={closeMenu}>Features</a>
            <a className="rounded-dd px-3 py-3 text-[13px] font-medium text-dd-text outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus" href="#how-it-works" onClick={closeMenu}>How it works</a>
            <a className="rounded-dd px-3 py-3 text-[13px] font-medium text-dd-text outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus" href="https://github.com/bloodf/durindoor#readme" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="rounded-dd px-3 py-3 text-[13px] font-medium text-dd-text outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus" href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer">GitHub</a>
            <Button variant="primary" className="mt-2 w-full" onClick={() => router.push("/dashboard")}>Get started</Button>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
