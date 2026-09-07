import React from "react";

const FALLBACK_ORIGIN = "http://storybook.local";
const LOCAL_ASSET_PATH = /^\/(?:durindoor-wordmark\.png$|(?:assets|fonts|_next|providers|icons)\/)/;

function fixtureOrigin() {
  return new URL(globalThis.location?.href || FALLBACK_ORIGIN);
}

function resolvedImageSource(source) {
  const raw = source instanceof URL ? source.href : source?.src ?? source;
  const url = new URL(raw, fixtureOrigin());
  if (url.protocol === "data:" || url.protocol === "blob:") return url.href;
  if (url.origin === fixtureOrigin().origin && LOCAL_ASSET_PATH.test(url.pathname)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  throw new Error("Storybook fixture image: remote or non-asset src not allowed");
}

/**
 * Local-assets-only `next/image` substitute for Storybook. It renders a real
 * `<img>` so screen readers, focus order and asset loading work the same as in
 * production, but it does not invoke `next/image`'s optimizer pipeline (which
 * needs the Next.js server). External URLs raise a fixture error so stories
 * can never silently depend on a CDN at preview time.
 */
function StorybookImage({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  quality,
  placeholder,
  blurDataURL,
  sizes,
  onLoad,
  onError,
  loader,
  style,
  className,
  ...rest
}) {
  if (alt == null) throw new Error("Storybook fixture image requires alt");
  const resolvedStyle = fill
    ? { position: "absolute", inset: 0, height: "100%", width: "100%", ...style }
    : style;
  const resolvedWidth = fill ? undefined : (width ?? undefined);
  const resolvedHeight = fill ? undefined : (height ?? undefined);
  return (
    <img
      src={resolvedImageSource(src)}
      alt={alt}
      width={resolvedWidth}
      height={resolvedHeight}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      data-priority={priority ? "true" : undefined}
      data-blur={blurDataURL ? "true" : undefined}
      data-placeholder={placeholder}
      onLoad={onLoad}
      onError={onError}
      style={resolvedStyle}
      className={className}
      {...rest}
    />
  );
}

export default StorybookImage;
export { StorybookImage };
