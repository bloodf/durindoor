/** Return a deployment secret only for the instance it was configured for. */
export function gitlabDeploymentSecret(baseUrl, configuredBaseUrl, secret) {
  if (!secret || !baseUrl || !configuredBaseUrl) return "";
  try {
    const selected = new URL(baseUrl);
    const configured = new URL(configuredBaseUrl);
    if (selected.username || selected.password || configured.username || configured.password ||
        selected.search || selected.hash || configured.search || configured.hash) return "";
    const canonical = (url) => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    return canonical(selected) === canonical(configured) ? secret : "";
  } catch {
    return "";
  }
}

/** Provider responses are untrusted and must not be echoed into client errors. */
export function gitlabRequestError(status) {
  const authentication = status === 401 || status === 403;
  return {
    error: {
      message: authentication ? "GitLab Duo authentication failed" : "GitLab Duo request failed",
      type: authentication ? "authentication_error" : "api_error",
    },
  };
}
