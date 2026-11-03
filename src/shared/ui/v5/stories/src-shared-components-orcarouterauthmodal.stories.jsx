// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/OrcaRouterAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-auth/OrcaRouterAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/OrcaRouterAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OAuthCodeFlow = { ...reviewStory(original.OAuthCodeFlow, {"source":"src/shared/components/OrcaRouterAuthModal.stories.jsx","standalone":false}) };
export const ApiKeyFailure = { ...reviewStory(original.ApiKeyFailure, {"source":"src/shared/components/OrcaRouterAuthModal.stories.jsx","standalone":false}) };
