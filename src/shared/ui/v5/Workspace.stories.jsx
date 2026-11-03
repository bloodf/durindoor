import ReviewUsagePage from './usage/ReviewUsagePage.jsx';
import { usageFixture } from './usage/fixtures.js';
import { reviewDecorator } from './ReviewFrame.jsx';
import { reviewParameters } from './review-parameters.js';
const meta = { title: 'V5 review/Start here', component: ReviewUsagePage, decorators: [reviewDecorator], parameters: reviewParameters({ storyFixture: usageFixture }, { source: 'Source-backed admin workspace', standalone: false }) };
export default meta;
export const ExploreWorkspace = {};
