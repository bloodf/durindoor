import { useEffect, useState } from "react";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout.js";
import Select from "@/shared/ui/components/Select.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { REVIEW_SURFACES } from "./review-manifest.js";
import { surfaceForRoute, isReviewComponent } from "./review-navigation.js";
import "./review.css";
import ReviewIconHelp from "./motion/ReviewIconHelp.jsx";

function iframeUrl(id, route) {
  const manager = window.parent !== window && !window.parent.location.pathname.endsWith("iframe.html");
  const url = new URL(manager ? window.parent.location.href : window.location.href);
  if (manager) url.searchParams.set("path", `/story/${id}`);
  else url.searchParams.set("id", id);
  if (route) url.searchParams.set("v5Route", route);
  else url.searchParams.delete("v5Route");
  return url.href;
}

function openReview(id, route) {
  const manager = window.parent !== window && !window.parent.location.pathname.endsWith("iframe.html");
  (manager ? window.parent : window).location.assign(iframeUrl(id, route));
}

/** Review uses the real authenticated shell and fixture-local Next navigation.
 * Cross-page navigation opens the corresponding source-backed story; in-page
 * query changes remain owned by the page. The selected resource travels as a
 * relative v5Route, never as a server URL or credentials.
 */
export function ReviewFrame({ children, context }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [redirect, setRedirect] = useState("");
  const review = context.parameters.v5Review;
  const componentOnly = isReviewComponent(review.source, review.componentOnly);
  const fixturePath = context.parameters.storyFixture?.pathname || "/dashboard/usage";
  useEffect(() => {
    const record = (event) => setRedirect(event.detail.destination);
    window.addEventListener("v5-review-redirect", record);
    return () => window.removeEventListener("v5-review-redirect", record);
  }, []);
  useEffect(() => {
    const navigation = globalThis.__STORYBOOK_NAV__;
    if (!navigation) return;
    const initialPath = navigation.__current().split("?")[0];
    return navigation.onNavigate(() => {
      const route = navigation.__current();
      if (context.parameters.v5Review.keepRedirectVisible) return;
      if (route.split("?")[0] === initialPath) return;
      const destination = surfaceForRoute(route);
      if (destination) openReview(destination.storyId, route);
    });
  }, [fixturePath]);

  const options = REVIEW_SURFACES.filter((surface) =>
    `${surface.title} ${surface.source}`.toLowerCase().includes(search.toLowerCase()),
  ).map((surface) => ({ value: surface.storyId, label: surface.title, hint: `${surface.states.length} scenarios` }));
  const controls = <section className="v5-review-bar" aria-label="Storybook review navigation">
    <div className="v5-review-context"><strong>V5 review</strong><span>Sample data</span></div>
    <Button size="sm" variant="secondary" icon="travel_explore" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>Browse workflows</Button>
    {redirect && <span role="status">Requested redirect: {redirect}</span>}
    {expanded && <div className="v5-review-browser">
      <label htmlFor="v5-review-search">Find a page or component</label>
      <input id="v5-review-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Providers, quota, authentication…" />
      <Select aria-label="Review workflow" value={context.id} options={options} onChange={(id) => openReview(id)} fullWidth />
      <p>{review.source} · {context.name}</p>
    </div>}
  </section>;
  if (componentOnly) return <div className="v5-review-surface v5-review-component"><ReviewIconHelp />{children}</div>;
  if (review.standalone) return <div className="v5-review-surface"><ReviewIconHelp />{controls}<div className="v5-review-standalone" data-v5-story-canvas>{children}</div></div>;
  return <div className="v5-review-surface"><ReviewIconHelp /><DashboardLayout>{controls}<div className="v5-review-content" data-v5-story-canvas>{children}</div></DashboardLayout></div>;
}

export function reviewDecorator(Story, context) {
  const params = globalThis.__STORYBOOK_NAV__?.useParams() || {};
  const args = { ...context.args };
  if (params.toolId && "toolId" in args) args.toolId = params.toolId;
  return <ReviewFrame context={context}><Story args={args} /></ReviewFrame>;
}

// Rejected prototype galleries remain an explicit archive for comparison.
export default function ArchivedReviewFrame({ children }) { return children; }
