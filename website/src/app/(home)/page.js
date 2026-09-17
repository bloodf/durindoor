import Hero from "@site/components/home/hero/Hero.jsx";
import ServiceKinds from "@site/components/home/sections/ServiceKinds.jsx";
import FlowSection from "@site/components/home/flow/FlowSection.jsx";
import Constellation from "@site/components/home/sections/Constellation.jsx";
import ToolsMarquee from "@site/components/home/sections/ToolsMarquee.jsx";
import TokenSavers from "@site/components/home/sections/TokenSavers.jsx";
import QuotaUsage from "@site/components/home/sections/QuotaUsage.jsx";
import Features from "@site/components/home/sections/Features.jsx";
import QuickStart from "@site/components/home/sections/QuickStart.jsx";
import DemoTeaser from "@site/components/home/sections/DemoTeaser.jsx";
import FinalCta from "@site/components/home/sections/FinalCta.jsx";
import Footer from "@site/components/home/sections/Footer.jsx";
import { CursorGlow, Nav, ScrollProgress, SmoothScroll } from "@site/components/home/ui/chrome.jsx";
import { RuneDivider } from "@site/components/home/ui/primitives.jsx";

// Story order: the door opens (hero), what walks through it (kinds), how it
// routes (flow + fallback), who is behind it (providers, tools), what it saves
// (tokens, quota), leftover surfaces (features), then the way in.
export default function HomePage() {
  return (
    <SmoothScroll>
      <ScrollProgress />
      <CursorGlow />
      <Nav />
      <main id="main">
        <Hero />
        <ServiceKinds />
        <FlowSection />
        <Constellation />
        <ToolsMarquee />
        <RuneDivider />
        <TokenSavers />
        <QuotaUsage />
        <Features />
        <QuickStart />
        <DemoTeaser />
        <FinalCta />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
