// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Toggle.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-actions/Toggle", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const States = { ...reviewStory(original.States, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}) };
export const ConnectionRowActiveSwitch = { ...reviewStory(original.ConnectionRowActiveSwitch, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}) };
export const TimelineLiveToggle = { ...reviewStory(original.TimelineLiveToggle, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}) };
export const WorkingState = { ...reviewStory(original.WorkingState, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}) };
export const RtlKnob = { ...reviewStory(original.RtlKnob, {"source":"src/shared/components/Toggle.stories.jsx","standalone":false}) };
