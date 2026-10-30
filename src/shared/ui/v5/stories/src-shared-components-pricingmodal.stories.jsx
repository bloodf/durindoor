// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/PricingModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-domain/PricingModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Loaded = { ...reviewStory(original.Loaded, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}) };
export const SavePersistsAndReopens = { ...reviewStory(original.SavePersistsAndReopens, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}) };
export const SaveErrorVisible = { ...reviewStory(original.SaveErrorVisible, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}) };
export const LoadErrorVisible = { ...reviewStory(original.LoadErrorVisible, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}) };
export const ResetPendingDisablesCloseAndChangesRates = { ...reviewStory(original.ResetPendingDisablesCloseAndChangesRates, {"source":"src/shared/components/PricingModal.stories.jsx","standalone":false}) };
