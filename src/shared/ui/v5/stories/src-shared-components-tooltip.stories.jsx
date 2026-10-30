// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Tooltip.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-overlays/Tooltip", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Tooltip.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OnIconButton = { ...reviewStory(original.OnIconButton, {"source":"src/shared/components/Tooltip.stories.jsx","standalone":false}) };
export const OnFocusableIcon = { ...reviewStory(original.OnFocusableIcon, {"source":"src/shared/components/Tooltip.stories.jsx","standalone":false}) };
