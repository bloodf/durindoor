// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/components/AddCompatibleModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/components/AddCompatibleModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OpenAIOpen = { ...reviewStory(original.OpenAIOpen, {"source":"src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.stories.jsx","standalone":false}) };
export const AnthropicInvalid = { ...reviewStory(original.AnthropicInvalid, {"source":"src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.stories.jsx","standalone":false}) };
