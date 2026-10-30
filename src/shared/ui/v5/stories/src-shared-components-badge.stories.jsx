// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Badge.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared Surfaces/Badge", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}) };
export const AllVariants = { ...reviewStory(original.AllVariants, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}) };
export const WithDotAndIcon = { ...reviewStory(original.WithDotAndIcon, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}) };
export const StatusInList = { ...reviewStory(original.StatusInList, {"source":"src/shared/components/Badge.stories.jsx","standalone":false}) };
