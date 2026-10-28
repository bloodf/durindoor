// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/headroom/HeadroomClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/savers/HeadroomClient", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/headroom/HeadroomClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const RunningWithEvents = { ...reviewStory(original.RunningWithEvents, {"source":"src/app/(dashboard)/dashboard/headroom/HeadroomClient.stories.jsx","standalone":false}) };
export const SetupDiagnostic = { ...reviewStory(original.SetupDiagnostic, {"source":"src/app/(dashboard)/dashboard/headroom/HeadroomClient.stories.jsx","standalone":false}) };
