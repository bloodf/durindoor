// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/ConfirmDialog.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Overlays/ConfirmDialog", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/ConfirmDialog.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Danger = { ...reviewStory(original.Danger, {"source":"src/shared/ui/components/ConfirmDialog.stories.jsx","standalone":false}) };
export const Primary = { ...reviewStory(original.Primary, {"source":"src/shared/ui/components/ConfirmDialog.stories.jsx","standalone":false}) };
