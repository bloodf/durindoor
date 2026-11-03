// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/IFlowCookieModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-oauth/IFlowCookieModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/IFlowCookieModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/components/IFlowCookieModal.stories.jsx","standalone":false}) };
export const ServerError = { ...reviewStory(original.ServerError, {"source":"src/shared/components/IFlowCookieModal.stories.jsx","standalone":false}) };
export const EmptySubmit = { ...reviewStory(original.EmptySubmit, {"source":"src/shared/components/IFlowCookieModal.stories.jsx","standalone":false}) };
