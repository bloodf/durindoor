// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/InferenceStatus", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}) };
export const Error = { ...reviewStory(original.Error, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}) };
export const Passed = { ...reviewStory(original.Passed, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}) };
export const Skipped = { ...reviewStory(original.Skipped, {"source":"src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.stories.jsx","standalone":false}) };
