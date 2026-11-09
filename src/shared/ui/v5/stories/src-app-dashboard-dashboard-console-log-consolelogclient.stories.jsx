// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/operations/ConsoleLogClient", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Streaming = { ...reviewStory(original.Streaming, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const Filtered = { ...reviewStory(original.Filtered, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const Paused = { ...reviewStory(original.Paused, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const ResumeFromPause = { ...reviewStory(original.ResumeFromPause, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const TransportUnavailable = { ...reviewStory(original.TransportUnavailable, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
export const ClearRejected = { ...reviewStory(original.ClearRejected, {"source":"src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.stories.jsx","standalone":false}) };
