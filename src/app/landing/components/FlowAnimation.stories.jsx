import React from "react";
import FlowAnimation from "./FlowAnimation.js";

export default {
  title: "Production/Public/Landing/FlowAnimation",
  component: FlowAnimation,
  parameters: { layout: "padded" },
};

export const Default = { render: () => <FlowAnimation /> };

export const MobileFallback = {
  render: () => <FlowAnimation />,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
