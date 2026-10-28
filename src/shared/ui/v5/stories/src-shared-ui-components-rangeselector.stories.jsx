// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/RangeSelector.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/RangeSelector", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const ValidCustom = { ...reviewStory(original.ValidCustom, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const OpenCustom = { ...reviewStory(original.OpenCustom, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const InvalidCustom = { ...reviewStory(original.InvalidCustom, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const AppliedCustom = { ...reviewStory(original.AppliedCustom, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const CustomCancel = { ...reviewStory(original.CustomCancel, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const Small = { ...reviewStory(original.Small, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const Long = { ...reviewStory(original.Long, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const Narrow = { ...reviewStory(original.Narrow, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const Keyboard = { ...reviewStory(original.Keyboard, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
export const InToolbar = { ...reviewStory(original.InToolbar, {"source":"src/shared/ui/components/RangeSelector.stories.jsx","standalone":false}) };
