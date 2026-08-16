// Shared constants and helpers.
// Loaded with importScripts() in the service worker and a <script> tag in
// options.html, so this file must stay a plain script — no ES modules.

const DEFAULT_SETTINGS = {
  gracePeriodMs: 15000,
  alarmSound: true,
  blacklist: [
    'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
    'tiktok.com', 'facebook.com', 'youtube.com', 'netflix.com', 'hulu.com', 'twitch.tv'
  ]
};

// Turn free-form input ("https://Reddit.com/r/all", " www.reddit.com ") into a
// bare lower-case hostname ("reddit.com"). Returns '' when unusable.
function normalizeDomain(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;

  let hostname;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    return '';
  }

  hostname = hostname.replace(/^www\./, '');

  // Must look like a real domain: labels separated by at least one dot, each
  // label <=63 chars and the whole hostname <=253 chars (DNS limits)
  if (hostname.length > 253) return '';
  if (!/^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(hostname)) return '';

  return hostname;
}

// A hostname matches a blacklist entry only on an exact match or a real
// subdomain, so 'notyoutube.com' no longer matches 'youtube.com'.
function hostMatchesDomain(hostname, domain) {
  if (!hostname || !domain) return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// Check a tab URL against the blacklist. Stored entries are normalized too, so
// legacy values saved before normalization existed still work.
function isBlacklistedUrl(url, blacklist) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }

  return (blacklist || []).some((entry) => hostMatchesDomain(hostname, normalizeDomain(entry)));
}
