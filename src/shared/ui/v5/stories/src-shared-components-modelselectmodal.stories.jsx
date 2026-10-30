// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ModelSelectModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/ModelSelectModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OpenLLM = { ...reviewStory(original.OpenLLM, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}) };
export const WithSelection = { ...reviewStory(original.WithSelection, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}) };
export const WithCombosAndSelection = { ...reviewStory(original.WithCombosAndSelection, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}) };
export const EmbeddingKind = { ...reviewStory(original.EmbeddingKind, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}) };
export const Closed = { ...reviewStory(original.Closed, {"source":"src/shared/components/ModelSelectModal.stories.jsx","standalone":false}) };
