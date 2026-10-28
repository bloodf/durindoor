// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Checkbox.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Forms/Checkbox", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const SoloUnchecked = { ...reviewStory(original.SoloUnchecked, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
export const SoloChecked = { ...reviewStory(original.SoloChecked, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
export const WithLabelAndHint = { ...reviewStory(original.WithLabelAndHint, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
export const Error = { ...reviewStory(original.Error, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
export const Controlled = { ...reviewStory(original.Controlled, {"source":"src/shared/ui/components/Checkbox.stories.jsx","standalone":false}) };
