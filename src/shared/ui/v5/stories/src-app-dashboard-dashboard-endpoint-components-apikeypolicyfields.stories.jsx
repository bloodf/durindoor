// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/ApiKeyPolicyFields", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AllModels = { ...reviewStory(original.AllModels, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx","standalone":false}) };
export const SelectedModelsScope = { ...reviewStory(original.SelectedModelsScope, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx","standalone":false}) };
export const CatalogLoading = { ...reviewStory(original.CatalogLoading, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx","standalone":false}) };
export const UsageLimitReached = { ...reviewStory(original.UsageLimitReached, {"source":"src/app/(dashboard)/dashboard/endpoint/components/ApiKeyPolicyFields.stories.jsx","standalone":false}) };
