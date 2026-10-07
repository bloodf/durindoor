import Link from "next/link";
import { DocsSearchTrigger } from "./SearchTrigger.jsx";

export function DocsHero({ title, pitch, quickStartHref, apiHref }) {
  return (
    <section className="dd-docs-hero" aria-labelledby="docs-hero-title">
      <div className="dd-docs-hero-main">
        <h1 id="docs-hero-title" className="dd-docs-hero-title">
          {title}
        </h1>
        <p className="dd-docs-hero-pitch">{pitch}</p>
        <div className="dd-docs-hero-actions">
          <Link
            href={quickStartHref}
            className="dd-docs-btn dd-docs-btn-primary"
          >
            Set up your gateway
          </Link>
          <Link href={apiHref} className="dd-docs-btn dd-docs-btn-ghost">
            API reference
          </Link>
        </div>
        <DocsSearchTrigger />
      </div>
      <figure className="dd-docs-gate">
        <img
          src="/brand/durindoor-gateway.webp"
          alt="An engraved stone gate opening into emerald light"
          width="1920"
          height="1080"
          fetchPriority="high"
        />
        <figcaption>Speak, friend, and enter.</figcaption>
      </figure>
    </section>
  );
}
