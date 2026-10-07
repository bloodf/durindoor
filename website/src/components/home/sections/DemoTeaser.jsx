"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { Magnetic } from "../ui/primitives.jsx";
export default function DemoTeaser() {
  const { t } = useHomeLocale();
  return (
    <section
      id="demo"
      className="section actual-demo"
      aria-labelledby="demo-title"
    >
      <div className="container">
        <div className="demo-heading">
          <div>
            <h2 id="demo-title">
              {t("Walk through the dashboard, no install")}
            </h2>
            <p>
              {t(
                "The demo runs the real DurinDoor interface against mocked data, so you can click every page before you run it yourself.",
              )}
            </p>
          </div>
          <Magnetic internal href="/demo-preview" className="btn btn-ghost">
            {t("Open the live demo")} ↗
          </Magnetic>
        </div>
        <div className="actual-demo-window">
          <iframe
            src="/demo-preview"
            title={t("Live demo")}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-downloads"
          />
        </div>
        <p className="actual-demo-note">
          {t("Mocked data. Nothing leaves your browser.")}
        </p>
      </div>
    </section>
  );
}
