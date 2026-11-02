// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ComboFormModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-domain/ComboFormModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ComboFormModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Create = { ...reviewStory(original.Create, {"source":"src/shared/components/ComboFormModal.stories.jsx","standalone":false}) };
export const EditWithPriorityAndCapabilities = { ...reviewStory(original.EditWithPriorityAndCapabilities, {"source":"src/shared/components/ComboFormModal.stories.jsx","standalone":false}) };
export const AliasFetchError = { ...reviewStory(original.AliasFetchError, {"source":"src/shared/components/ComboFormModal.stories.jsx","standalone":false}) };
