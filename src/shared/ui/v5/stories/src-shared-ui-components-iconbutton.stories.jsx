// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/IconButton.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Actions/IconButton", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Ghost = { ...reviewStory(original.Ghost, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const Secondary = { ...reviewStory(original.Secondary, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const KeyboardActivation = { ...reviewStory(original.KeyboardActivation, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const VariantMatrix = { ...reviewStory(original.VariantMatrix, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
export const ToolbarRow = { ...reviewStory(original.ToolbarRow, {"source":"src/shared/ui/components/IconButton.stories.jsx","standalone":false}) };
