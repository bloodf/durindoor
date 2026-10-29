// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/ApiKeyModelAccessModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AllowListWithSecurityWarning = { ...reviewStory(original.AllowListWithSecurityWarning, {"source":"src/app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.stories.jsx","standalone":false}) };
export const AddAndRejectDuplicateRule = { ...reviewStory(original.AddAndRejectDuplicateRule, {"source":"src/app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.stories.jsx","standalone":false}) };
export const EmptyBlockList = { ...reviewStory(original.EmptyBlockList, {"source":"src/app/(dashboard)/dashboard/endpoint/ApiKeyModelAccessModal.stories.jsx","standalone":false}) };
