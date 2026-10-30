// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/timeline/TimelineDetailPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Loaded = { ...reviewStory(original.Loaded, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const Waterfall = { ...reviewStory(original.Waterfall, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const ExpandSseChunks = { ...reviewStory(original.ExpandSseChunks, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const CopyAsJson = { ...reviewStory(original.CopyAsJson, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const MissingTrace = { ...reviewStory(original.MissingTrace, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const Skeleton = { ...reviewStory(original.Skeleton, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const CompletedWithoutDuration = { ...reviewStory(original.CompletedWithoutDuration, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
export const RunningWithoutDuration = { ...reviewStory(original.RunningWithoutDuration, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/page.stories.jsx","standalone":false}) };
