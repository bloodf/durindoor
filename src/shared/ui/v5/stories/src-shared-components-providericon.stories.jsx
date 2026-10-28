// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ProviderIcon.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-provider/ProviderIcon", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ProviderIcon.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ProviderAsset = { ...reviewStory(original.ProviderAsset, {"source":"src/shared/components/ProviderIcon.stories.jsx","standalone":false}) };
export const MissingAssetFallback = { ...reviewStory(original.MissingAssetFallback, {"source":"src/shared/components/ProviderIcon.stories.jsx","standalone":false}) };
