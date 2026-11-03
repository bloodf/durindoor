// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/profile/SelectiveTransferPanel.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/profile/SelectiveTransferPanel", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/profile/SelectiveTransferPanel.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const LoadCatalog = { ...reviewStory(original.LoadCatalog, {"source":"src/app/(dashboard)/dashboard/profile/SelectiveTransferPanel.stories.jsx","standalone":false}) };
export const PreviewRequiresSecondPassword = { ...reviewStory(original.PreviewRequiresSecondPassword, {"source":"src/app/(dashboard)/dashboard/profile/SelectiveTransferPanel.stories.jsx","standalone":false}) };
export const ExportRequiresSecretConfirmation = { ...reviewStory(original.ExportRequiresSecretConfirmation, {"source":"src/app/(dashboard)/dashboard/profile/SelectiveTransferPanel.stories.jsx","standalone":false}) };
