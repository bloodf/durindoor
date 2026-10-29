// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/PeakHourProtectionEditor.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/PeakHourProtectionEditor", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/PeakHourProtectionEditor.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/components/PeakHourProtectionEditor.stories.jsx","standalone":false}) };
export const ConfiguredWindow = { ...reviewStory(original.ConfiguredWindow, {"source":"src/shared/components/PeakHourProtectionEditor.stories.jsx","standalone":false}) };
