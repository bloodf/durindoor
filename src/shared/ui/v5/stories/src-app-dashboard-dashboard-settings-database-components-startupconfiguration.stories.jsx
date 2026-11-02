// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/settings/StartupConfiguration", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const TestConnection = { ...reviewStory(original.TestConnection, {"source":"src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.stories.jsx","standalone":false}) };
export const SaveRequiresRestart = { ...reviewStory(original.SaveRequiresRestart, {"source":"src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.stories.jsx","standalone":false}) };
