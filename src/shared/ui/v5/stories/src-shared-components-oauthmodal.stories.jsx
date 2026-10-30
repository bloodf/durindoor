// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/OAuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-oauth/OAuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const LoadingRoutingOptions = { ...reviewStory(original.LoadingRoutingOptions, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
export const ManualCallback = { ...reviewStory(original.ManualCallback, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
export const ProxyAndFingerprint = { ...reviewStory(original.ProxyAndFingerprint, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
export const DeviceCodeFlow = { ...reviewStory(original.DeviceCodeFlow, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
export const XaiCopiesAuthUrl = { ...reviewStory(original.XaiCopiesAuthUrl, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
export const AuthorizationFailure = { ...reviewStory(original.AuthorizationFailure, {"source":"src/shared/components/OAuthModal.stories.jsx","standalone":false}) };
