// Accept only complete HTTP origins, with optional one-label DNS wildcard.
// The one-label rule matches wildcard TLS certificates used by the Helm chart.
export function createOriginMatcher(origins: string) {
  const rules = origins.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const wildcard = value.includes('://*.');
    const url = new URL(wildcard ? value.replace('://*.', '://wildcard.') : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || value.includes('*') && !wildcard ||
        (value.match(/\*/g)?.length ?? 0) > 1) {
      throw new Error('WEB_ORIGINS must contain HTTP origins or one-label DNS wildcards');
    }
    return { url, wildcard, suffix: wildcard ? url.hostname.slice('wildcard'.length) : '' };
  });

  return (origin: string | undefined): boolean => {
    // Non-browser clients do not send an Origin header.
    if (origin === undefined) return true;
    let url: URL;
    try { url = new URL(origin); } catch { return false; }
    if (url.origin !== origin || url.username || url.password) return false;
    return rules.some(rule => {
      if (!rule.wildcard) return url.origin === rule.url.origin;
      if (url.protocol !== rule.url.protocol || url.port !== rule.url.port || !url.hostname.endsWith(rule.suffix)) return false;
      const label = url.hostname.slice(0, -rule.suffix.length);
      return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label);
    });
  };
}
