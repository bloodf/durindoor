// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/skills/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/operations/SkillsPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/skills/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/skills/page.stories.jsx","standalone":false}) };
export const CopyEntryLink = { ...reviewStory(original.CopyEntryLink, {"source":"src/app/(dashboard)/dashboard/skills/page.stories.jsx","standalone":false}) };
export const CopyInstructionFailure = { ...reviewStory(original.CopyInstructionFailure, {"source":"src/app/(dashboard)/dashboard/skills/page.stories.jsx","standalone":false}) };
export const ManyEndpoints = { ...reviewStory(original.ManyEndpoints, {"source":"src/app/(dashboard)/dashboard/skills/page.stories.jsx","standalone":false}) };
