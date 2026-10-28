// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/playground/PlaygroundPageClient", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const EmptyConversation = { ...reviewStory(original.EmptyConversation, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}) };
export const SendsCompletion = { ...reviewStory(original.SendsCompletion, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}) };
export const ModelMenuProviderSwitch = { ...reviewStory(original.ModelMenuProviderSwitch, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}) };
export const ChatHistoryPopover = { ...reviewStory(original.ChatHistoryPopover, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}) };
export const CompletionError = { ...reviewStory(original.CompletionError, {"source":"src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.stories.jsx","standalone":false}) };
