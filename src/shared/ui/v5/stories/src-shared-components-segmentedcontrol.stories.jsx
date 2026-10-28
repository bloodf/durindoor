// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/SegmentedControl.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-actions/SegmentedControl", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const UsageOverviewDetails = { ...reviewStory(original.UsageOverviewDetails, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const DisabledOption = { ...reviewStory(original.DisabledOption, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const PerOptionIcon = { ...reviewStory(original.PerOptionIcon, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const LargeSize = { ...reviewStory(original.LargeSize, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const LtrKeyboard = { ...reviewStory(original.LtrKeyboard, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
export const RtlKeyboard = { ...reviewStory(original.RtlKeyboard, {"source":"src/shared/components/SegmentedControl.stories.jsx","standalone":false}) };
