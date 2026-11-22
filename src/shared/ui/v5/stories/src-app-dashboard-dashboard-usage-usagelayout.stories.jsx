// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/usage/Layout", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OverviewWidgets = { ...reviewStory(original.OverviewWidgets, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}) };
export const LayoutCancelRestoresOrder = { ...reviewStory(original.LayoutCancelRestoresOrder, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}) };
export const LayoutSaveAndResetConfirm = { ...reviewStory(original.LayoutSaveAndResetConfirm, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}) };
export const LayoutStorageBlocked = { ...reviewStory(original.LayoutStorageBlocked, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}) };
export const UsageStatsUnavailable = { ...reviewStory(original.UsageStatsUnavailable, {"source":"src/app/(dashboard)/dashboard/usage/UsageLayout.stories.jsx","standalone":false}) };
