// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/playground/PlaygroundCompare.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/playground/PlaygroundCompare", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundCompare.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const TwoColumns = { ...reviewStory(original.TwoColumns, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundCompare.stories.jsx","standalone":false}) };
export const RunsAllColumns = { ...reviewStory(original.RunsAllColumns, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundCompare.stories.jsx","standalone":false}) };
export const NoModels = { ...reviewStory(original.NoModels, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundCompare.stories.jsx","standalone":false}) };
