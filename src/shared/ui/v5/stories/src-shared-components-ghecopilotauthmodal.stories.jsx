// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/GheCopilotAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-auth/GheCopilotAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/GheCopilotAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const InvalidOrigin = { ...reviewStory(original.InvalidOrigin, {"source":"src/shared/components/GheCopilotAuthModal.stories.jsx","standalone":false}) };
export const DeviceCodeHandoff = { ...reviewStory(original.DeviceCodeHandoff, {"source":"src/shared/components/GheCopilotAuthModal.stories.jsx","standalone":false}) };
