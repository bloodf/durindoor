// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/media-routes/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/media/MediaRoutes", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/media-routes/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AutomaticAndCustom = { ...reviewStory(original.AutomaticAndCustom, {"source":"src/app/(dashboard)/dashboard/media-routes/page.stories.jsx","standalone":false}) };
export const CustomizeAddRemoveAndSave = { ...reviewStory(original.CustomizeAddRemoveAndSave, {"source":"src/app/(dashboard)/dashboard/media-routes/page.stories.jsx","standalone":false}) };
export const LoadError = { ...reviewStory(original.LoadError, {"source":"src/app/(dashboard)/dashboard/media-routes/page.stories.jsx","standalone":false}) };
export const EmptyRoute = { ...reviewStory(original.EmptyRoute, {"source":"src/app/(dashboard)/dashboard/media-routes/page.stories.jsx","standalone":false}) };
