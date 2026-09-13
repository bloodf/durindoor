import Hero from "@site/components/home/hero/Hero.jsx";
import FlowSection from "@site/components/home/flow/FlowSection.jsx";
import Features from "@site/components/home/sections/Features.jsx";
import QuickStart from "@site/components/home/sections/QuickStart.jsx";
import DemoTeaser from "@site/components/home/sections/DemoTeaser.jsx";
import ToolsMarquee from "@site/components/home/sections/ToolsMarquee.jsx";
import Footer from "@site/components/home/sections/Footer.jsx";
import { CursorGlow, Nav, ScrollProgress, SmoothScroll } from "@site/components/home/ui/chrome.jsx";
import { RuneDivider } from "@site/components/home/ui/primitives.jsx";

export default function HomePage() {
  return (
    <SmoothScroll>
        <ScrollProgress />
        <CursorGlow />
        <Nav />
        <main id="main">
          <Hero />
          <FlowSection />
          <RuneDivider />
          <Features />
          <ToolsMarquee />
          <QuickStart />
          <DemoTeaser />
        </main>
        <Footer />
    </SmoothScroll>
  );
}
