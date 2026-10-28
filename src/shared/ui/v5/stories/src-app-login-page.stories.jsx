// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/login/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Public/Login", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/login/page.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const PasswordEntry = { ...reviewStory(original.PasswordEntry, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const OIDCAndPassword = { ...reviewStory(original.OIDCAndPassword, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const RateLimited = { ...reviewStory(original.RateLimited, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const PasswordChangeRequired = { ...reviewStory(original.PasswordChangeRequired, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const LoginErrorAndResetHint = { ...reviewStory(original.LoginErrorAndResetHint, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const OIDCOnly = { ...reviewStory(original.OIDCOnly, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
export const OIDCMisconfigured = { ...reviewStory(original.OIDCMisconfigured, {"source":"src/app/login/page.stories.jsx","standalone":true}) };
