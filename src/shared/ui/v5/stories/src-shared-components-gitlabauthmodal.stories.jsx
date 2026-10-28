// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/GitLabAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-oauth/GitLabAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ModeSelection = { ...reviewStory(original.ModeSelection, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}) };
export const OAuthConfiguration = { ...reviewStory(original.OAuthConfiguration, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}) };
export const PatSubmit = { ...reviewStory(original.PatSubmit, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}) };
export const PatFailure = { ...reviewStory(original.PatFailure, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}) };
export const EmptyPatBlocksSubmit = { ...reviewStory(original.EmptyPatBlocksSubmit, {"source":"src/shared/components/GitLabAuthModal.stories.jsx","standalone":false}) };
