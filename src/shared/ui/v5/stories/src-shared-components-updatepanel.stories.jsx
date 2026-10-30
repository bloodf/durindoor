// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/UpdatePanel.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared-Support/UpdatePanel", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/UpdatePanel.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AutoSuccess = { ...reviewStory(original.AutoSuccess, {"source":"src/shared/components/UpdatePanel.stories.jsx","standalone":false}) };
export const AutoFailedFallsBackToManual = { ...reviewStory(original.AutoFailedFallsBackToManual, {"source":"src/shared/components/UpdatePanel.stories.jsx","standalone":false}) };
export const ManualInstallOpensFromIdle = { ...reviewStory(original.ManualInstallOpensFromIdle, {"source":"src/shared/components/UpdatePanel.stories.jsx","standalone":false}) };
