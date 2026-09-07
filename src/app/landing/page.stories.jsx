import React from "react";
import LandingPage from "./page.js";

export default {
  title: "Production/Public/Landing",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
};

export const Default = { render: () => <LandingPage /> };
