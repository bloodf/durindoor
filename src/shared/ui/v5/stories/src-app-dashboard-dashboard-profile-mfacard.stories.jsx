// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/profile/MfaCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/profile/MfaCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const SetupApiError = { ...reviewStory(original.SetupApiError, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}) };
export const EnrollmentShowsBackupCodes = { ...reviewStory(original.EnrollmentShowsBackupCodes, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}) };
export const VerificationApiError = { ...reviewStory(original.VerificationApiError, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}) };
export const Enabled = { ...reviewStory(original.Enabled, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}) };
export const DisableApiError = { ...reviewStory(original.DisableApiError, {"source":"src/app/(dashboard)/dashboard/profile/MfaCard.stories.jsx","standalone":false}) };
