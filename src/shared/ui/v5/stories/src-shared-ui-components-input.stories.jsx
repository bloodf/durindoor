// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Input.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Forms/Input", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const WithIcon = { ...reviewStory(original.WithIcon, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const Small = { ...reviewStory(original.Small, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const WithHint = { ...reviewStory(original.WithHint, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const WithError = { ...reviewStory(original.WithError, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
export const Password = { ...reviewStory(original.Password, {"source":"src/shared/ui/components/Input.stories.jsx","standalone":false}) };
