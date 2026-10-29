// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/XiaomiMimoAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-auth/XiaomiMimoAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/XiaomiMimoAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const LocalCredentialsFound = { ...reviewStory(original.LocalCredentialsFound, {"source":"src/shared/components/XiaomiMimoAuthModal.stories.jsx","standalone":false}) };
export const BrowserLoginClusterSelection = { ...reviewStory(original.BrowserLoginClusterSelection, {"source":"src/shared/components/XiaomiMimoAuthModal.stories.jsx","standalone":false}) };
export const DetectionFallback = { ...reviewStory(original.DetectionFallback, {"source":"src/shared/components/XiaomiMimoAuthModal.stories.jsx","standalone":false}) };
