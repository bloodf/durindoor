// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/proxy-pools/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/operations/ProxyPoolsPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Populated = { ...reviewStory(original.Populated, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const OpenCreateDialog = { ...reviewStory(original.OpenCreateDialog, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const CreateSuccess = { ...reviewStory(original.CreateSuccess, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const EditSuccess = { ...reviewStory(original.EditSuccess, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const DeleteSuccess = { ...reviewStory(original.DeleteSuccess, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const DisableDeadProxies = { ...reviewStory(original.DisableDeadProxies, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const CreateError = { ...reviewStory(original.CreateError, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const DeleteError = { ...reviewStory(original.DeleteError, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const CreatePending = { ...reviewStory(original.CreatePending, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
export const DeletePending = { ...reviewStory(original.DeletePending, {"source":"src/app/(dashboard)/dashboard/proxy-pools/page.stories.jsx","standalone":false}) };
