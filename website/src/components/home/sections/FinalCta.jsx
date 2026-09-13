"use client";

import { useRouter } from "next/navigation";
import { LumenCta } from "@designcodeio/threeui/components/LumenCta";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { GitHubMark } from "../ui/Icon.jsx";
import { GITHUB_URL } from "../data.js";
import { Magnetic, Reveal, RuneDivider } from "../ui/primitives.jsx";

// LumenCta ships violet; hue-rotate lands its gradient on the DurinDoor emerald.
const LUMEN_EMERALD = { hue: -118, saturation: 1.05, brightness: 1.05 };

export default function FinalCta() {
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
          <h2 id="final-title" className="final-title">
            Speak, friend, <span className="ithildin">and enter.</span>
          </h2>
          <p className="final-lead">
            Install it on your machine in a minute, or walk through the live demo first. The word is on the door.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="final-actions">
          <LumenCta
            className="final-lumen"
            label="Open the live demo"
            onClick={() => router.push("/dashboard")}
            {...LUMEN_EMERALD}
          />
          <Magnetic href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn-ghost btn-large">
            <GitHubMark size={18} />
            View source
          </Magnetic>
        </Reveal>
      </div>
    </section>
  );
}
