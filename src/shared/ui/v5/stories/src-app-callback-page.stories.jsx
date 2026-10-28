// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/callback/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Public/Callback", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/callback/page.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const LiveSuccess = { ...reviewStory(original.LiveSuccess, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const LiveError = { ...reviewStory(original.LiveError, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const LiveManual = { ...reviewStory(original.LiveManual, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const Processing = { ...reviewStory(original.Processing, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const Success = { ...reviewStory(original.Success, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const Done = { ...reviewStory(original.Done, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const Error = { ...reviewStory(original.Error, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
export const ManualFallback = { ...reviewStory(original.ManualFallback, {"source":"src/app/callback/page.stories.jsx","standalone":true}) };
