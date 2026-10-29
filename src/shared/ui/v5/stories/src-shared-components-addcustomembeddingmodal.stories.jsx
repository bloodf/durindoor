// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/AddCustomEmbeddingModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/AddCustomEmbeddingModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/AddCustomEmbeddingModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Open = { ...reviewStory(original.Open, {"source":"src/shared/components/AddCustomEmbeddingModal.stories.jsx","standalone":false}) };
export const InvalidEndpoint = { ...reviewStory(original.InvalidEndpoint, {"source":"src/shared/components/AddCustomEmbeddingModal.stories.jsx","standalone":false}) };
export const EditingExisting = { ...reviewStory(original.EditingExisting, {"source":"src/shared/components/AddCustomEmbeddingModal.stories.jsx","standalone":false}) };
export const Closed = { ...reviewStory(original.Closed, {"source":"src/shared/components/AddCustomEmbeddingModal.stories.jsx","standalone":false}) };
