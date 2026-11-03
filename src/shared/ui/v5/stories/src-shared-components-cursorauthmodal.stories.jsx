// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/CursorAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-kiro/CursorAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AutoDetected = { ...reviewStory(original.AutoDetected, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const AutoDetecting = { ...reviewStory(original.AutoDetecting, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const WindowsManual = { ...reviewStory(original.WindowsManual, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const ManualImportValidation = { ...reviewStory(original.ManualImportValidation, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const ManualImportFailure = { ...reviewStory(original.ManualImportFailure, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const ManualImportSuccess = { ...reviewStory(original.ManualImportSuccess, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
export const Importing = { ...reviewStory(original.Importing, {"source":"src/shared/components/CursorAuthModal.stories.jsx","standalone":false}) };
