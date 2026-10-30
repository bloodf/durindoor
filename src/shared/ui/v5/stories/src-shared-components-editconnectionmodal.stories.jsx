// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/EditConnectionModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-config/EditConnectionModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ApiKeyOpenAI = { ...reviewStory(original.ApiKeyOpenAI, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const OAuthAccount = { ...reviewStory(original.OAuthAccount, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const AzurePanel = { ...reviewStory(original.AzurePanel, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const GooglePsePanel = { ...reviewStory(original.GooglePsePanel, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const CodexFingerprintPanel = { ...reviewStory(original.CodexFingerprintPanel, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const CloudflareAccountIdPanel = { ...reviewStory(original.CloudflareAccountIdPanel, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const SnowflakeAccountIdPanel = { ...reviewStory(original.SnowflakeAccountIdPanel, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const OpenAIResponsesStore = { ...reviewStory(original.OpenAIResponsesStore, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const RegionPickerXiaomi = { ...reviewStory(original.RegionPickerXiaomi, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const TestFailureBadge = { ...reviewStory(original.TestFailureBadge, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
export const Closed = { ...reviewStory(original.Closed, {"source":"src/shared/components/EditConnectionModal.stories.jsx","standalone":false}) };
