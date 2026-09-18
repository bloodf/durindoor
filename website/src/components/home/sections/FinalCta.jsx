"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { useRouter } from "next/navigation";
import { LumenCta } from "@designcodeio/threeui/components/LumenCta";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { Reveal, RuneDivider } from "../ui/primitives.jsx";

// LumenCta ships violet; hue-rotate lands its gradient on the DurinDoor emerald.
const LUMEN_EMERALD = { hue: -118, saturation: 1.05, brightness: 1.05 };

export default function FinalCta() {
  const { t } = useHomeLocale();
  const router = useRouter();
  return (
    <section id="enter" className="section section-final" aria-labelledby="final-title">
      {/* ThreeUI BellFieldBackground: a struck bell of teal filaments and gold embers. Click strikes it again. */}
      <ThreeStage effect="bell" className="final-bell" speed={0.7} emberAmount={1.2} brightness={1.1} />
      <div className="final-shade" aria-hidden="true" />
      <div className="container final-inner">
        <Reveal>
          <RuneDivider />
          <p className="final-kicker">Pedo mellon a minno</p>
          <h2 id="final-title" className="final-title">{t("Speak, friend,")}{" "}<span className="ithildin">{t("and enter.")}</span>
          </h2>
          <p className="final-lead">{t("npx durindoor starts a local process. Docker and a global install are under Quick start.")}</p>
        </Reveal>
        <Reveal delay={0.15} className="final-actions">
          <LumenCta
            className="final-lumen"
            label={t("Quick start")}
            onClick={() => {
              const node = document.getElementById("quick-start");
              if (node) node.scrollIntoView({ behavior: "smooth" });
              else router.push("/#quick-start");
            }}
            {...LUMEN_EMERALD}
          />
        </Reveal>
      </div>
    </section>
  );
}
