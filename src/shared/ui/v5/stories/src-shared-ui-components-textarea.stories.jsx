// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Textarea.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Forms/Textarea", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Textarea.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/Textarea.stories.jsx","standalone":false}) };
export const WithHint = { ...reviewStory(original.WithHint, {"source":"src/shared/ui/components/Textarea.stories.jsx","standalone":false}) };
export const WithError = { ...reviewStory(original.WithError, {"source":"src/shared/ui/components/Textarea.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Textarea.stories.jsx","standalone":false}) };
