// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Card.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Surfaces/Card", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
export const NamedDensity = { ...reviewStory(original.NamedDensity, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
export const Composed = { ...reviewStory(original.Composed, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
export const NarrowHeaderActions = { ...reviewStory(original.NarrowHeaderActions, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
export const Hoverable = { ...reviewStory(original.Hoverable, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
export const ProviderCard = { ...reviewStory(original.ProviderCard, {"source":"src/shared/ui/components/Card.stories.jsx","standalone":false}) };
