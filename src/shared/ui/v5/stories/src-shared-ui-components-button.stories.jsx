// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Button.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Actions/Button", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Primary = { ...reviewStory(original.Primary, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Secondary = { ...reviewStory(original.Secondary, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Ghost = { ...reviewStory(original.Ghost, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Danger = { ...reviewStory(original.Danger, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const WithLeadingIcon = { ...reviewStory(original.WithLeadingIcon, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const WithTrailingIcon = { ...reviewStory(original.WithTrailingIcon, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const LongLabelWithIcon = { ...reviewStory(original.LongLabelWithIcon, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Small = { ...reviewStory(original.Small, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const KeyboardActivation = { ...reviewStory(original.KeyboardActivation, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
export const VariantMatrix = { ...reviewStory(original.VariantMatrix, {"source":"src/shared/ui/components/Button.stories.jsx","standalone":false}) };
