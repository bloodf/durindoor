// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/detail/Widgets", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ConnectionRowScenario = { ...reviewStory(original.ConnectionRowScenario, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const ConnectionRowCooldown = { ...reviewStory(original.ConnectionRowCooldown, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const CompatibleModels = { ...reviewStory(original.CompatibleModels, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const PassthroughModels = { ...reviewStory(original.PassthroughModels, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const AddApiKey = { ...reviewStory(original.AddApiKey, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const AddCustomModel = { ...reviewStory(original.AddCustomModel, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const CompatibleEdit = { ...reviewStory(original.CompatibleEdit, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const BulkImports = { ...reviewStory(original.BulkImports, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
export const ErrorState = { ...reviewStory(original.ErrorState, {"source":"src/app/(dashboard)/dashboard/providers/[id]/widgets.stories.jsx","standalone":false}) };
