// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Select.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Forms/Select", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const WithLabelAndHint = { ...reviewStory(original.WithLabelAndHint, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const Error = { ...reviewStory(original.Error, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const ManyOptions = { ...reviewStory(original.ManyOptions, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const WithIconsAndHints = { ...reviewStory(original.WithIconsAndHints, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const PlacementTop = { ...reviewStory(original.PlacementTop, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const InsideModal = { ...reviewStory(original.InsideModal, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const CompactFilterToolbar = { ...reviewStory(original.CompactFilterToolbar, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
export const ExampleForm = { ...reviewStory(original.ExampleForm, {"source":"src/shared/ui/components/Select.stories.jsx","standalone":false}) };
