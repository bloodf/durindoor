"use client";

const LINK = "inline-flex min-h-11 min-w-11 items-center rounded-dd text-sm text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus";

export default function Footer() {
  return (
    <footer className="border-t border-dd-border bg-dd-bg-alt px-6 pb-8 pt-16">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2">
            <div className="mb-6 flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-dd bg-dd-accent text-dd-on-accent"><span aria-hidden="true" className="material-symbols-outlined text-[18px]">hub</span></span><h3 className="text-lg font-bold text-dd-text">DurinDoor</h3></div>
            <p className="mb-6 max-w-xs text-sm text-dd-muted">Unified endpoint for AI generation. Connect, route, and manage AI providers with ease.</p>
            <a className="inline-flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus" href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer" aria-label="DurinDoor on GitHub"><span aria-hidden="true" className="material-symbols-outlined">code</span></a>
          </div>
          <div className="flex flex-col gap-4"><h4 className="font-bold text-dd-text">Product</h4><a className={LINK} href="#features">Features</a><a className={LINK} href="/dashboard">Dashboard</a><a className={LINK} href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer">Changelog</a></div>
          <div className="flex flex-col gap-4"><h4 className="font-bold text-dd-text">Resources</h4><a className={LINK} href="https://github.com/bloodf/durindoor#readme" target="_blank" rel="noopener noreferrer">Documentation</a><a className={LINK} href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer">GitHub</a><a className={LINK} href="https://www.npmjs.com/package/durindoor" target="_blank" rel="noopener noreferrer">NPM</a></div>
          <div className="flex flex-col gap-4"><h4 className="font-bold text-dd-text">Legal</h4><a className={LINK} href="https://github.com/bloodf/durindoor/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a></div>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-dd-border pt-8 md:flex-row"><p className="text-sm text-dd-subtle">© 2025 DurinDoor. All rights reserved.</p><div className="flex gap-6"><a className={LINK} href="https://github.com/bloodf/durindoor" target="_blank" rel="noopener noreferrer">GitHub</a><a className={LINK} href="https://www.npmjs.com/package/durindoor" target="_blank" rel="noopener noreferrer">NPM</a></div></div>
      </div>
    </footer>
  );
}
