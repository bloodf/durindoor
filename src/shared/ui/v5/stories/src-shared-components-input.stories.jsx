// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Input.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-actions/Input", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Input.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const FormStates = { ...reviewStory(original.FormStates, {"source":"src/shared/components/Input.stories.jsx","standalone":false}) };
export const EditConnectionModalFields = { ...reviewStory(original.EditConnectionModalFields, {"source":"src/shared/components/Input.stories.jsx","standalone":false}) };
export const ReadOnlyAuthUrl = { ...reviewStory(original.ReadOnlyAuthUrl, {"source":"src/shared/components/Input.stories.jsx","standalone":false}) };
export const NumericPolicyLimits = { ...reviewStory(original.NumericPolicyLimits, {"source":"src/shared/components/Input.stories.jsx","standalone":false}) };
export const WorkingValue = { ...reviewStory(original.WorkingValue, {"source":"src/shared/components/Input.stories.jsx","standalone":false}) };
