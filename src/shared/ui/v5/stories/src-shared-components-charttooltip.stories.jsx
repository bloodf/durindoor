// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/chartTooltip.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-analytics/ChartTooltip", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/chartTooltip.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Tokens = { ...reviewStory(original.Tokens, {"source":"src/shared/components/chartTooltip.stories.jsx","standalone":false}) };
export const Bytes = { ...reviewStory(original.Bytes, {"source":"src/shared/components/chartTooltip.stories.jsx","standalone":false}) };
