// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ManualConfigModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/ManualConfigModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ManualConfigModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Open = { ...reviewStory(original.Open, {"source":"src/shared/components/ManualConfigModal.stories.jsx","standalone":false}) };
export const LongContent = { ...reviewStory(original.LongContent, {"source":"src/shared/components/ManualConfigModal.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/components/ManualConfigModal.stories.jsx","standalone":false}) };
export const Closed = { ...reviewStory(original.Closed, {"source":"src/shared/components/ManualConfigModal.stories.jsx","standalone":false}) };
