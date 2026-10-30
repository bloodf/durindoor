// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../login/Login.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Redesign/Login", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AnimatedGate = { ...reviewStory(original.AnimatedGate, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const StaticFallback = { ...reviewStory(original.StaticFallback, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const AnimationPaused = { ...reviewStory(original.AnimationPaused, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const SigningIn = { ...reviewStory(original.SigningIn, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const InvalidPassword = { ...reviewStory(original.InvalidPassword, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const AuthenticationCode = { ...reviewStory(original.AuthenticationCode, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
export const OIDCAndPassword = { ...reviewStory(original.OIDCAndPassword, {"source":"src/shared/ui/v5/login/Login.stories.jsx","standalone":true}) };
