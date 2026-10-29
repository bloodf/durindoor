// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/WebLoginModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-web-login/WebLoginModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/WebLoginModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Waiting = { ...reviewStory(original.Waiting, {"source":"src/shared/components/WebLoginModal.stories.jsx","standalone":false}) };
export const Ready = { ...reviewStory(original.Ready, {"source":"src/shared/components/WebLoginModal.stories.jsx","standalone":false}) };
export const OriginNotConfigured = { ...reviewStory(original.OriginNotConfigured, {"source":"src/shared/components/WebLoginModal.stories.jsx","standalone":false}) };
