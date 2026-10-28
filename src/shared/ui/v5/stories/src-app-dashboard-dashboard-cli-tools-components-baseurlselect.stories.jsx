// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/BaseUrlSelect", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Local = { ...reviewStory(original.Local, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx","standalone":false}) };
export const Tunnel = { ...reviewStory(original.Tunnel, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx","standalone":false}) };
export const Cloud = { ...reviewStory(original.Cloud, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx","standalone":false}) };
export const SwitchToCustom = { ...reviewStory(original.SwitchToCustom, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.stories.jsx","standalone":false}) };
