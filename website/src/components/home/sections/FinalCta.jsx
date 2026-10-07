"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { CopyButton, Magnetic } from "../ui/primitives.jsx";
export default function FinalCta() {
  const { t } = useHomeLocale();
  return (
    <section
      id="enter"
      className="section section-final"
      aria-labelledby="final-title"
    >
      <div className="container final-layout">
        <div>
          <h2 id="final-title">{t("Open the door")}</h2>
          <p>{t("Open source · MIT · Self-hosted AI gateway")}</p>
          <Magnetic
            internal
            href="/docs/getting-started"
            className="btn btn-primary"
          >
            {t("Read the docs")} ↗
          </Magnetic>
        </div>
        <div className="final-terminal">
          <div className="final-command">
            <span aria-hidden="true">$</span>
            <code>npx durindoor</code>
            <CopyButton text="npx durindoor" />
          </div>
          <p>
            {t(
              "npx durindoor starts a local process. Docker and a global install are under Quick start.",
            )}
          </p>
          <a href="#quick-start">{t("Quick start")} ↗</a>
        </div>
      </div>
    </section>
  );
}
