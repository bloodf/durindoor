// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/settings/database/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/settings/DatabaseSettingsPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}) };
export const StartupEnvFromEnvironment = { ...reviewStory(original.StartupEnvFromEnvironment, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}) };
export const StartupEnvFromFile = { ...reviewStory(original.StartupEnvFromFile, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}) };
export const PostgresCutoverTarget = { ...reviewStory(original.PostgresCutoverTarget, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}) };
export const StatusUnavailable = { ...reviewStory(original.StatusUnavailable, {"source":"src/app/(dashboard)/dashboard/settings/database/page.stories.jsx","standalone":false}) };
