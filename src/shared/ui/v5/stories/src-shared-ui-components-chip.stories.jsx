// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Chip.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Surfaces/Chip", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}) };
export const States = { ...reviewStory(original.States, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}) };
export const ChipCloud = { ...reviewStory(original.ChipCloud, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}) };
export const AsFilters = { ...reviewStory(original.AsFilters, {"source":"src/shared/ui/components/Chip.stories.jsx","standalone":false}) };
