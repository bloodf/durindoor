// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/savers/TokenSaverOverview", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Metrics = { ...reviewStory(original.Metrics, {"source":"src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.stories.jsx","standalone":false}) };
export const EmptyWithDiagnostic = { ...reviewStory(original.EmptyWithDiagnostic, {"source":"src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.stories.jsx","standalone":false}) };
