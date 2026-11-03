// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/SetupDiagnosticCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-provider/SetupDiagnosticCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/SetupDiagnosticCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const WithFixesAndRetry = { ...reviewStory(original.WithFixesAndRetry, {"source":"src/shared/components/SetupDiagnosticCard.stories.jsx","standalone":false}) };
export const CopyCommandFlipsToCopied = { ...reviewStory(original.CopyCommandFlipsToCopied, {"source":"src/shared/components/SetupDiagnosticCard.stories.jsx","standalone":false}) };
export const RetryInvokesCallback = { ...reviewStory(original.RetryInvokesCallback, {"source":"src/shared/components/SetupDiagnosticCard.stories.jsx","standalone":false}) };
export const WithoutDiagnosticsRendersNothing = { ...reviewStory(original.WithoutDiagnosticsRendersNothing, {"source":"src/shared/components/SetupDiagnosticCard.stories.jsx","standalone":false}) };
