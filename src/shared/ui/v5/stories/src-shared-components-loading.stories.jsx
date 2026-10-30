// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Loading.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared Surfaces/Loading", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const SpinnerSizes = { ...reviewStory(original.SpinnerSizes, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const PageLoadingBehavior = { ...reviewStory(original.PageLoadingBehavior, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const SkeletonVariants = { ...reviewStory(original.SkeletonVariants, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const CardSkeletonInGrid = { ...reviewStory(original.CardSkeletonInGrid, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const LoadingSwitchboard = { ...reviewStory(original.LoadingSwitchboard, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
export const ComposedWithSkeleton = { ...reviewStory(original.ComposedWithSkeleton, {"source":"src/shared/components/Loading.stories.jsx","standalone":false}) };
