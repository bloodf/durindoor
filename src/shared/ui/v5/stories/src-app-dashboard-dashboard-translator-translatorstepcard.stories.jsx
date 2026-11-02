// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/translator/TranslatorStepCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const CollapsedEmpty = { ...reviewStory(original.CollapsedEmpty, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
export const CollapsedLoaded = { ...reviewStory(original.CollapsedLoaded, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
export const Expanded = { ...reviewStory(original.Expanded, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
export const TextExpanded = { ...reviewStory(original.TextExpanded, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
export const KeyboardEnterToggle = { ...reviewStory(original.KeyboardEnterToggle, {"source":"src/app/(dashboard)/dashboard/translator/TranslatorStepCard.stories.jsx","standalone":false}) };
