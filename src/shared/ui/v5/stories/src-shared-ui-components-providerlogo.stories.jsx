// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/ProviderLogo.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Surfaces/ProviderLogo", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Grid = { ...reviewStory(original.Grid, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}) };
export const AliasesAndFallback = { ...reviewStory(original.AliasesAndFallback, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}) };
export const CaseInsensitive = { ...reviewStory(original.CaseInsensitive, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}) };
export const Missing = { ...reviewStory(original.Missing, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/ui/components/ProviderLogo.stories.jsx","standalone":false}) };
