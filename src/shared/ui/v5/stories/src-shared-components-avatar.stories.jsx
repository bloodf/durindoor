// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Avatar.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared Surfaces/Avatar", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}) };
export const InitialsOnly = { ...reviewStory(original.InitialsOnly, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}) };
export const FallbackForEmptyName = { ...reviewStory(original.FallbackForEmptyName, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}) };
export const BackgroundImageSource = { ...reviewStory(original.BackgroundImageSource, {"source":"src/shared/components/Avatar.stories.jsx","standalone":false}) };
