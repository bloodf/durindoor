// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/components/SecurityWarning.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/SecurityWarning", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/components/SecurityWarning.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const MessageOnly = { ...reviewStory(original.MessageOnly, {"source":"src/app/(dashboard)/dashboard/endpoint/components/SecurityWarning.stories.jsx","standalone":false}) };
export const WithLinkAction = { ...reviewStory(original.WithLinkAction, {"source":"src/app/(dashboard)/dashboard/endpoint/components/SecurityWarning.stories.jsx","standalone":false}) };
export const WithAnchorAction = { ...reviewStory(original.WithAnchorAction, {"source":"src/app/(dashboard)/dashboard/endpoint/components/SecurityWarning.stories.jsx","standalone":false}) };
