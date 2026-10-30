// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/KiroSocialOAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-kiro/KiroSocialOAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Initializing = { ...reviewStory(original.Initializing, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const RoutingOptionsLoading = { ...reviewStory(original.RoutingOptionsLoading, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const GoogleInput = { ...reviewStory(original.GoogleInput, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const GoogleWithProxyPool = { ...reviewStory(original.GoogleWithProxyPool, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const GitHubInput = { ...reviewStory(original.GitHubInput, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const ManualCallbackSuccess = { ...reviewStory(original.ManualCallbackSuccess, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const ManualCallbackFailure = { ...reviewStory(original.ManualCallbackFailure, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
export const Exchanging = { ...reviewStory(original.Exchanging, {"source":"src/shared/components/KiroSocialOAuthModal.stories.jsx","standalone":false}) };
