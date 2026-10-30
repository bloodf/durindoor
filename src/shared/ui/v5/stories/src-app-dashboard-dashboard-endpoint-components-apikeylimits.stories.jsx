// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/ApiKeyLimits", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const UsageSummary = { ...reviewStory(original.UsageSummary, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits.stories.jsx","standalone":false}) };
export const EditLimits = { ...reviewStory(original.EditLimits, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits.stories.jsx","standalone":false}) };
export const InvalidLimitBlocksSave = { ...reviewStory(original.InvalidLimitBlocksSave, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits.stories.jsx","standalone":false}) };
