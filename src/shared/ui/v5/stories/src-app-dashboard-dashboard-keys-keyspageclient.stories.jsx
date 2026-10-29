// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/API Keys", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}) };
export const KeyLimits = { ...reviewStory(original.KeyLimits, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}) };
export const RevocationRejectedAndRetry = { ...reviewStory(original.RevocationRejectedAndRetry, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}) };
export const RevocationPending = { ...reviewStory(original.RevocationPending, {"source":"src/app/(dashboard)/dashboard/keys/KeysPageClient.stories.jsx","standalone":false}) };
