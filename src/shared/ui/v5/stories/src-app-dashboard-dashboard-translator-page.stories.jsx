// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/translator/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/translator/TranslatorWorkspace", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const LoadedRequest = { ...reviewStory(original.LoadedRequest, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const ConvertsRequest = { ...reviewStory(original.ConvertsRequest, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const ConvertsToTarget = { ...reviewStory(original.ConvertsToTarget, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const SendsTargetRequest = { ...reviewStory(original.SendsTargetRequest, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const LoadFailure = { ...reviewStory(original.LoadFailure, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const DismissError = { ...reviewStory(original.DismissError, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const MobileKeyboard = { ...reviewStory(original.MobileKeyboard, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
export const RTL = { ...reviewStory(original.RTL, {"source":"src/app/(dashboard)/dashboard/translator/page.stories.jsx","standalone":false}) };
