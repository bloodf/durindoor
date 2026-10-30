// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Badge.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Surfaces/Badge", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Badge.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/ui/components/Badge.stories.jsx","standalone":false}) };
export const Tones = { ...reviewStory(original.Tones, {"source":"src/shared/ui/components/Badge.stories.jsx","standalone":false}) };
export const WithIcons = { ...reviewStory(original.WithIcons, {"source":"src/shared/ui/components/Badge.stories.jsx","standalone":false}) };
export const InContext = { ...reviewStory(original.InContext, {"source":"src/shared/ui/components/Badge.stories.jsx","standalone":false}) };
