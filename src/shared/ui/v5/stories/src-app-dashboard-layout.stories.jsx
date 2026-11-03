// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/layout.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Shell/DashboardRootLayout", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/layout.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ChildComposition = { ...reviewStory(original.ChildComposition, {"source":"src/app/(dashboard)/layout.stories.jsx","standalone":false}) };
