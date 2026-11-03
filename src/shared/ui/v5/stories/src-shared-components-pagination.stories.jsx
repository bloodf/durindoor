// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Pagination.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-overlays/Pagination", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Pagination.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Interactive = { ...reviewStory(original.Interactive, {"source":"src/shared/components/Pagination.stories.jsx","standalone":false}) };
export const TransitionalPageSizeTwenty = { ...reviewStory(original.TransitionalPageSizeTwenty, {"source":"src/shared/components/Pagination.stories.jsx","standalone":false}) };
export const AllRows = { ...reviewStory(original.AllRows, {"source":"src/shared/components/Pagination.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/components/Pagination.stories.jsx","standalone":false}) };
