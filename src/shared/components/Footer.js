"use client";

import Link from "next/link";
import { APP_CONFIG } from "@/shared/constants/config";

const footerLinks = {
  product: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
    { label: "Changelog", href: "#" },
  ],
  resources: [
    { label: "Documentation", href: "#" },
    { label: "API Reference", href: "#" },
    { label: "Help Center", href: "#" },
  ],
  company: [
    { label: "About", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Contact", href: "#" },
  ],
};

const linkClassName = "inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus";

function LinkGroup({ title, links }) {
  return (
    <section aria-labelledby={`footer-${title}`}>
      <h2 id={`footer-${title}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-dd-text">
        {title}
      </h2>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className={linkClassName}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-dd-border bg-dd-bg-alt py-10 text-[13px]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <section className="sm:col-span-2 lg:col-span-1" aria-label={`${APP_CONFIG.name} information`}>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex size-11 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent" aria-hidden="true">
                <span className="material-symbols-outlined text-[22px] leading-none">hub</span>
              </span>
              <span className="text-lg font-semibold tracking-tight text-dd-text">{APP_CONFIG.name}</span>
            </div>
            <p className="max-w-sm leading-relaxed text-dd-muted">
              The unified interface for modern AI infrastructure. Secure, observable, and scalable.
            </p>
            <div className="mt-4 flex items-center gap-1">
              <a href="#" className="inline-flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus" aria-label="Twitter">
                <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">public</span>
              </a>
              <a href="#" className="inline-flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus" aria-label="GitHub">
                <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">code</span>
              </a>
            </div>
          </section>
          <LinkGroup title="Product" links={footerLinks.product} />
          <LinkGroup title="Resources" links={footerLinks.resources} />
          <LinkGroup title="Company" links={footerLinks.company} />
        </div>
        <div className="mt-8 flex flex-col gap-3 border-t border-dd-border-subtle pt-5 text-xs text-dd-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {APP_CONFIG.name} Inc. All rights reserved.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="#" className={linkClassName}>Privacy Policy</Link>
            <Link href="#" className={linkClassName}>Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
