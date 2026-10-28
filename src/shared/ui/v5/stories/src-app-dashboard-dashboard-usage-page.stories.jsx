// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/usage/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
import ReviewUsagePage from '../usage/ReviewUsagePage.jsx';
import { usageFixture } from '../usage/fixtures.js';
const meta = { ...originalMeta, title: "V5 review/Pages/usage/Page", parameters: reviewParameters({ ...originalMeta.parameters, storyFixture: usageFixture }, {"source":"src/app/(dashboard)/dashboard/usage/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Overview = { ...reviewStory(original.Overview, {"source":"src/app/(dashboard)/dashboard/usage/page.stories.jsx","standalone":false}), parameters: reviewParameters({ ...originalMeta.parameters, ...original.Overview.parameters, storyFixture: usageFixture }, {"source":"src/app/(dashboard)/dashboard/usage/page.stories.jsx","standalone":false}), render: () => <ReviewUsagePage /> };
