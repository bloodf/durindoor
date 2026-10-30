// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Select.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-actions/Select", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Select.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Standalone = { ...reviewStory(original.Standalone, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
export const ModalFormFields = { ...reviewStory(original.ModalFormFields, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
export const ToolbarPlacement = { ...reviewStory(original.ToolbarPlacement, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
export const EmptyOptions = { ...reviewStory(original.EmptyOptions, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
export const WorkingSelection = { ...reviewStory(original.WorkingSelection, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
export const EscapeCloses = { ...reviewStory(original.EscapeCloses, {"source":"src/shared/components/Select.stories.jsx","standalone":false}) };
