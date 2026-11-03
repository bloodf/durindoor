// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/StatusAlert", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Success = { ...reviewStory(original.Success, {"source":"src/app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx","standalone":false}) };
export const Warning = { ...reviewStory(original.Warning, {"source":"src/app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx","standalone":false}) };
export const Info = { ...reviewStory(original.Info, {"source":"src/app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx","standalone":false}) };
export const ErrorWithLink = { ...reviewStory(original.ErrorWithLink, {"source":"src/app/(dashboard)/dashboard/endpoint/components/StatusAlert.stories.jsx","standalone":false}) };
