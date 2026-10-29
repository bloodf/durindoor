// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/media/KindListing", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const OpenAddCustomEmbeddingModal = { ...reviewStory(original.OpenAddCustomEmbeddingModal, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const LocalAndCustomProviders = { ...reviewStory(original.LocalAndCustomProviders, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const OpenAddCustomSystemOneModal = { ...reviewStory(original.OpenAddCustomSystemOneModal, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const LoadFailureAndRetry = { ...reviewStory(original.LoadFailureAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const MalformedResponseAndRetry = { ...reviewStory(original.MalformedResponseAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
export const NetworkFailureAndRetry = { ...reviewStory(original.NetworkFailureAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/[kind]/page.stories.jsx","standalone":false}) };
