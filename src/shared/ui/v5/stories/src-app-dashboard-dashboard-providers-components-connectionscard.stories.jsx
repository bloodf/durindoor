// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/components/ConnectionsCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/components/ConnectionsCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Connected = { ...reviewStory(original.Connected, {"source":"src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.stories.jsx","standalone":false}) };
export const Cooldown = { ...reviewStory(original.Cooldown, {"source":"src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.stories.jsx","standalone":false}) };
