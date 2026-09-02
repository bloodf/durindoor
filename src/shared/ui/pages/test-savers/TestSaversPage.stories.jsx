import React from "react";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import TestSaversPage from "./TestSaversPage.jsx";

const RESULTS = {
  beforeTokens: "8,412",
  afterTokens: "2,731",
  savedTokens: "5,681",
  savings: "67.5",
  before: `git status --short
 M src/open-sse/handlers/chatCore.js
 M src/open-sse/translator/index.js
?? tests/translator/bugs-tool-results.test.js

npm run test:ci
✓ 318 tests passed
Full verbose logs include dependency scans, cache paths, and repeated progress output.`,
  after: `git status: 2 modified, 1 untracked
Tests: 318 passed
Changed: chatCore.js, translator/index.js
Added: bugs-tool-results.test.js`,
};

const meta = {
  title: "Durin DS/Pages/Test Savers",
  component: TestSaversPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/compression-studio",
      title: "Test Savers",
      subtitle: "Preview how each compression engine would transform a request body",
      icon: "science",
    }),
  ],
};

export default meta;

/** Empty form with preview disabled until both model and input are present. */
export const Default = {};

/** Complete request-body editor for testing advanced JSON payloads. */
export const AdvancedJson = {
  args: { initialAdvanced: true },
};

/** Side-by-side compression result with token counts and semantic savings badges. */
export const Results = {
  args: { initialResults: RESULTS },
};
