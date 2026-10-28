// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Tooltip.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Overlays/Tooltip", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Top = { ...reviewStory(original.Top, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const Bottom = { ...reviewStory(original.Bottom, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const Left = { ...reviewStory(original.Left, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const Right = { ...reviewStory(original.Right, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const LongText = { ...reviewStory(original.LongText, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const CollapsedParent = { ...reviewStory(original.CollapsedParent, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const Keyboard = { ...reviewStory(original.Keyboard, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
export const Touch = { ...reviewStory(original.Touch, {"source":"src/shared/ui/components/Tooltip.stories.jsx","standalone":false}) };
