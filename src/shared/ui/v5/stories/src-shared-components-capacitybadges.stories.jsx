// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/CapacityBadges.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared Surfaces/CapacityBadges", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
export const AllCapabilities = { ...reviewStory(original.AllCapabilities, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
export const ColorOverride = { ...reviewStory(original.ColorOverride, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
export const SizeScale = { ...reviewStory(original.SizeScale, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
export const EmptyOrMissingCaps = { ...reviewStory(original.EmptyOrMissingCaps, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
export const KeyboardFocusRevealsTooltip = { ...reviewStory(original.KeyboardFocusRevealsTooltip, {"source":"src/shared/components/CapacityBadges.stories.jsx","standalone":false}) };
