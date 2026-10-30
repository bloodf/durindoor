// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/compression-studio/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/compression-studio", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/compression-studio/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/compression-studio/page.stories.jsx","standalone":false}) };
export const PreviewResult = { ...reviewStory(original.PreviewResult, {"source":"src/app/(dashboard)/dashboard/compression-studio/page.stories.jsx","standalone":false}) };
export const UnavailableEngine = { ...reviewStory(original.UnavailableEngine, {"source":"src/app/(dashboard)/dashboard/compression-studio/page.stories.jsx","standalone":false}) };
export const PreviewFailure = { ...reviewStory(original.PreviewFailure, {"source":"src/app/(dashboard)/dashboard/compression-studio/page.stories.jsx","standalone":false}) };
