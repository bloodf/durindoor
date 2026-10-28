// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/StatusDot.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Surfaces/StatusDot", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/StatusDot.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/ui/components/StatusDot.stories.jsx","standalone":false}) };
export const Tones = { ...reviewStory(original.Tones, {"source":"src/shared/ui/components/StatusDot.stories.jsx","standalone":false}) };
export const Pulse = { ...reviewStory(original.Pulse, {"source":"src/shared/ui/components/StatusDot.stories.jsx","standalone":false}) };
export const InContext = { ...reviewStory(original.InContext, {"source":"src/shared/ui/components/StatusDot.stories.jsx","standalone":false}) };
