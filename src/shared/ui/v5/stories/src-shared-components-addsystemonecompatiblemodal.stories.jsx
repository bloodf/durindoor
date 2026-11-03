// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/AddSystemoneCompatibleModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/AddSystemoneCompatibleModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/AddSystemoneCompatibleModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AddAndDiscover = { ...reviewStory(original.AddAndDiscover, {"source":"src/shared/components/AddSystemoneCompatibleModal.stories.jsx","standalone":false}) };
export const DiscoveryError = { ...reviewStory(original.DiscoveryError, {"source":"src/shared/components/AddSystemoneCompatibleModal.stories.jsx","standalone":false}) };
export const EditAndRegister = { ...reviewStory(original.EditAndRegister, {"source":"src/shared/components/AddSystemoneCompatibleModal.stories.jsx","standalone":false}) };
