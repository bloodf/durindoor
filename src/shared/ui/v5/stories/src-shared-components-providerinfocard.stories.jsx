// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ProviderInfoCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-provider/ProviderInfoCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ProviderInfoCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const FullCard = { ...reviewStory(original.FullCard, {"source":"src/shared/components/ProviderInfoCard.stories.jsx","standalone":false}) };
export const NoConfigReturnsNull = { ...reviewStory(original.NoConfigReturnsNull, {"source":"src/shared/components/ProviderInfoCard.stories.jsx","standalone":false}) };
