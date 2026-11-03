import { MediaAutomaticEndpointRoutes, MediaCustomUnavailableModels, MediaResetToAutomatic } from '../preservation/Routing.stories.jsx';
const meta = { title: 'Media routes', parameters: { reviewRoute: '/dashboard/media-routes' } };
export default meta;
export const Automatic = { ...MediaAutomaticEndpointRoutes };
export const CustomUnavailable = { ...MediaCustomUnavailableModels };
export const ResetToAutomatic = { ...MediaResetToAutomatic };
