// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Example", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const WebSearch = { ...reviewStory(original.WebSearch, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}) };
export const WebSearchRun = { ...reviewStory(original.WebSearchRun, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}) };
export const ImageGen = { ...reviewStory(original.ImageGen, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}) };
export const CodexStreamingRun = { ...reviewStory(original.CodexStreamingRun, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}) };
export const RunError = { ...reviewStory(original.RunError, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.stories.jsx","standalone":false}) };
