"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { COMPARISON } from "../content.js";
import Icon from "../ui/Icon.jsx";
import { Reveal, SectionHeader } from "../ui/primitives.jsx";

// Real <table> on wide screens; below 700px the CSS turns each row into a card
// and the `data-label` attributes provide the column names.
export default function Compare() {
  const { t } = useHomeLocale();
  return (
    <section id="compare" className="section section-compare" aria-labelledby="compare-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("Before and after")}
          title={<span id="compare-title">{t("Wiring every tool by hand, or one door")}</span>}
          lead={t("What changes when your tools stop talking to providers directly.")}
        />
        <Reveal className="compare-frame">
          <table className="compare">
            <caption className="sr-only">{t("Per-tool provider setup compared with DurinDoor")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("When you need")}</th>
                <th scope="col">{t("Per-tool setup")}</th>
                <th scope="col" className="is-door">
                  DurinDoor
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.need}>
                  <th scope="row">{t(row.need)}</th>
                  <td data-label={t("Per-tool setup")} className="is-diy">
                    <span className="compare-mark is-no" aria-hidden="true" />
                    {t(row.diy)}
                  </td>
                  <td data-label="DurinDoor" className="is-door">
                    <span className="compare-mark is-yes" aria-hidden="true">
                      <Icon name="check" size={14} />
                    </span>
                    {t(row.door)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </section>
  );
}
