import originalMeta, { Settings, UnavailableServices } from '@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.stories.jsx';
const meta = { ...originalMeta, title: 'Token saver settings', parameters: { ...originalMeta.parameters, reviewRoute: '/dashboard/token-saver/settings' } };
export default meta;
export const AllSettings = { ...Settings };
export const DependencyMissing = { ...UnavailableServices };
