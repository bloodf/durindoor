import { isFunction } from "../../utils/typeChecks.js";

/** The authenticated review shell adds only its own exact request contracts.
 * Page fixtures win. Unknown API requests remain rejected by Storybook.
 */
export function reviewParameters(parameters = {}, review) {
  return {
    ...parameters,
    layout: 'fullscreen',
    v5Review: { ...review, ...parameters.v5Review },
    storyFixture: {
      scenario: 'default',
      ...parameters.storyFixture,
      routes: {
        'GET /api/auth/status': { body: { requireLogin: true, authenticated: true, loggedIn: true, authMode: 'password', user: { name: 'Review administrator', email: 'admin@example.test' } } },
        'GET /api/version': { body: { version: '4.10.1', hasUpdate: false } },
        'POST /api/auth/logout': { body: { success: true } },
        'POST /api/version/shutdown': { body: { success: true, message: 'Shutdown requested in the isolated fixture.' } },
        'POST /api/locale': { body: { success: true } },
        'GET /api/changelog': { body: { versions: [] } },
        ...parameters.storyFixture?.routes,
      },
    },
  };
}

export function reviewStory(story, review) {
  const original = isFunction(story) ? { ...story, render: story } : story;
  const pathname = original.parameters?.storyFixture?.pathname || "";
  const result = { ...original, parameters: {
    ...original.parameters,
    v5Review: { ...review, ...original.parameters?.v5Review, standalone: review.standalone || /^\/(?:login|callback)(?:\?|$)/.test(pathname) },
  } };
  if (original.play) result.play = (context) => original.play({ ...context, canvasElement: context.canvasElement.querySelector("[data-v5-story-canvas]") || context.canvasElement });
  return result;
}
