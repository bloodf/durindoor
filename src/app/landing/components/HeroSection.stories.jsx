import React from "react";
import HeroSection from "./HeroSection.js";

export default {
  title: "Production/Public/Landing/HeroSection",
  component: HeroSection,
  parameters: { layout: "fullscreen" },
};

export const Default = { render: () => <HeroSection /> };
