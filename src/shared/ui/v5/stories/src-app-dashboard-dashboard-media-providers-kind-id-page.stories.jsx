// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/media/ProviderDetail", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const EmbeddingExample = { ...reviewStory(original.EmbeddingExample, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx","standalone":false}) };
export const RunExample = { ...reviewStory(original.RunExample, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx","standalone":false}) };
export const TtsExample = { ...reviewStory(original.TtsExample, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx","standalone":false}) };
export const CustomEmbeddingDetail = { ...reviewStory(original.CustomEmbeddingDetail, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.stories.jsx","standalone":false}) };
