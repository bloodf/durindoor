// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/auto-configure", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const StatusPreview = { ...reviewStory(original.StatusPreview, {"source":"src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx","standalone":false}) };
export const RunSuccess = { ...reviewStory(original.RunSuccess, {"source":"src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx","standalone":false}) };
export const RunFailure = { ...reviewStory(original.RunFailure, {"source":"src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx","standalone":false}) };
export const StatusLoadRecovery = { ...reviewStory(original.StatusLoadRecovery, {"source":"src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.stories.jsx","standalone":false}) };
