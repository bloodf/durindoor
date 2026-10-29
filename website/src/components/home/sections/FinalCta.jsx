"use client";
import Icon from "../ui/Icon.jsx";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { NATIVE_SETUP } from "../content.js";
import { CopyButton, Magnetic } from "../ui/primitives.jsx";
const STARTUP = `${NATIVE_SETUP}\nnpx durindoor --host 127.0.0.1`;

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
          <p>{t("Open source. MIT. Self-hosted AI gateway")}</p>
          <Magnetic
            internal
            href="/docs/getting-started"
            className="btn btn-primary"
          >
            {t("Read the docs")} <Icon name="external" size={16} />
          </Magnetic>
        </div>
        <div className="final-terminal">
          <p className="setup-note">{t("Set your own initial password before starting. Keep both signing secrets for later starts.")}</p>
          <div className="final-command">
            <pre tabIndex={0}><code>{STARTUP}</code></pre>
            <CopyButton text={STARTUP} />
          </div>
          <p>
            {t(
              "npx durindoor starts a local process. Docker and a global install are under Quick start.",
            )}
          </p>
          <a href="#quick-start">{t("Quick start")} <Icon name="external" size={16} /></a>
        </div>
      </div>
    </section>
  );
}
