import Link from "next/link";
import { DocsSearchTrigger } from "./SearchTrigger.jsx";

export function DocsHero({ title, pitch, quickStartHref, apiHref }) {
  return (
    <section className="dd-docs-hero" aria-labelledby="docs-hero-title">
      <div className="dd-docs-hero-brand">
        <img src="/icons/icon-512.png" alt="" width={48} height={48} />
        <h1 id="docs-hero-title" className="dd-docs-hero-title">
          {title}
        </h1>
      </div>
      <p className="dd-docs-hero-pitch">{pitch}</p>
      <DocsSearchTrigger />
      <div className="dd-docs-hero-actions">
        <Link href={quickStartHref} className="dd-docs-btn dd-docs-btn-primary">
          Quick start
        </Link>
        <Link href={apiHref} className="dd-docs-btn dd-docs-btn-ghost">
          API reference
        </Link>
      </div>
    </section>
  );
}
