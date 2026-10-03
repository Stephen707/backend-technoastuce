// Query parameters whose value is a secret (single-use or bearer tokens).
const SECRET_PARAMS = /^(?:token|code|secret|password|key|signature|sig)$/i;

/**
 * Masks secret query parameters before a URL is logged, so tokens sent in
 * links (e.g. one-click unsubscribe) never end up in log files.
 * "/a?token=abc&page=2" -> "/a?token=[REDACTED]&page=2".
 */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const query = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        // keep the raw name
      }
      return SECRET_PARAMS.test(name) ? `${pair.slice(0, eq)}=[REDACTED]` : pair;
    })
    .join('&');
  return `${url.slice(0, q)}?${query}`;
}
