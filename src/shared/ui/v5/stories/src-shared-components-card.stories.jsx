// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Card.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared Surfaces/Card", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Card.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/components/Card.stories.jsx","standalone":false}) };
export const TitledWithIcon = { ...reviewStory(original.TitledWithIcon, {"source":"src/shared/components/Card.stories.jsx","standalone":false}) };
export const PaddingScale = { ...reviewStory(original.PaddingScale, {"source":"src/shared/components/Card.stories.jsx","standalone":false}) };
export const ElevatedAndHoverable = { ...reviewStory(original.ElevatedAndHoverable, {"source":"src/shared/components/Card.stories.jsx","standalone":false}) };
export const SubComponents = { ...reviewStory(original.SubComponents, {"source":"src/shared/components/Card.stories.jsx","standalone":false}) };
