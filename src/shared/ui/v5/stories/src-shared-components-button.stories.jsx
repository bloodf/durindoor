// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Button.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-actions/Button", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Button.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Variants = { ...reviewStory(original.Variants, {"source":"src/shared/components/Button.stories.jsx","standalone":false}) };
export const SizesAndLoading = { ...reviewStory(original.SizesAndLoading, {"source":"src/shared/components/Button.stories.jsx","standalone":false}) };
export const ModalAndAuthActions = { ...reviewStory(original.ModalAndAuthActions, {"source":"src/shared/components/Button.stories.jsx","standalone":false}) };
export const ToolCardApplyResetManualConfig = { ...reviewStory(original.ToolCardApplyResetManualConfig, {"source":"src/shared/components/Button.stories.jsx","standalone":false}) };
export const WorkingAction = { ...reviewStory(original.WorkingAction, {"source":"src/shared/components/Button.stories.jsx","standalone":false}) };
