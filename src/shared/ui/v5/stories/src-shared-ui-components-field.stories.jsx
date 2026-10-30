// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Field.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Forms/Field", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const WithHint = { ...reviewStory(original.WithHint, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}) };
export const WithError = { ...reviewStory(original.WithError, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}) };
export const Required = { ...reviewStory(original.Required, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}) };
export const CheckboxGroup = { ...reviewStory(original.CheckboxGroup, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}) };
export const ExampleForm = { ...reviewStory(original.ExampleForm, {"source":"src/shared/ui/components/Field.stories.jsx","standalone":false}) };
