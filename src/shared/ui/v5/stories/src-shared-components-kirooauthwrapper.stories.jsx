// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/KiroOAuthWrapper.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-kiro/KiroOAuthWrapper", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/KiroOAuthWrapper.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const MethodSelection = { ...reviewStory(original.MethodSelection, {"source":"src/shared/components/KiroOAuthWrapper.stories.jsx","standalone":false}) };
export const BuilderIdHandoff = { ...reviewStory(original.BuilderIdHandoff, {"source":"src/shared/components/KiroOAuthWrapper.stories.jsx","standalone":false}) };
export const IdcHandoff = { ...reviewStory(original.IdcHandoff, {"source":"src/shared/components/KiroOAuthWrapper.stories.jsx","standalone":false}) };
export const ImportSuccessShortCircuits = { ...reviewStory(original.ImportSuccessShortCircuits, {"source":"src/shared/components/KiroOAuthWrapper.stories.jsx","standalone":false}) };
