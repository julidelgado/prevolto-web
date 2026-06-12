// Cookieless pageview beacon for prevolto.com.
// Receives a tiny payload from the browser, enriches it with Vercel geo + UA,
// and inserts one row into Supabase `web_pageviews` (anon, insert-only via RLS).
// Read side lives in prevolto-ops (/web-traffic). No cookies, no PII stored raw:
// the visitor id is a daily-rotating salted hash of ip+ua (Plausible-style).

const crypto = require('crypto');

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|preview|monitor|curl|wget|python-requests|axios|headless|lighthouse|gptbot|claudebot|perplexity|ahrefs|semrush|dataforseo|yandex|applebot/i;
const SALT = 'prevolto-analytics-v1';

function pick(h, name) {
  const v = h[name];
  return Array.isArray(v) ? v[0] : (v || '');
}

function parseUA(ua) {
  ua = ua || '';
  let device = 'desktop';
  if (/iPad|Tablet/i.test(ua)) device = 'tablet';
  else if (/Mobi|Android|iPhone|iPod/i.test(ua)) device = 'mobile';

  let browser = 'Other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';

  let os = 'Other';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return { device, browser, os };
}

function refHost(referrer) {
  if (!referrer) return null;
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, '');
    if (/(^|\.)prevolto\.com$/i.test(h)) return null; // internal navigation = direct
    return h;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  // Beacons are POST and same-origin; respond fast and never block the page.
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const supaUrl = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!supaUrl || !anon) return res.status(204).end();

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const h = req.headers;
    const ua = pick(h, 'user-agent');
    const isBot = BOT_RE.test(ua);

    const ip = (pick(h, 'x-forwarded-for').split(',')[0] || pick(h, 'x-real-ip') || '').trim();
    const day = new Date().toISOString().slice(0, 10); // rotates the hash daily
    const visitorHash = crypto.createHash('sha256').update(SALT + '|' + day + '|' + ip + '|' + ua).digest('hex').slice(0, 32);

    const { device, browser, os } = parseUA(ua);

    let path = typeof body.path === 'string' ? body.path.slice(0, 300) : '/';
    if (!path.startsWith('/')) path = '/' + path;
    const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 400) : '';

    const row = {
      path,
      referrer: referrer || null,
      referrer_host: refHost(referrer),
      country: pick(h, 'x-vercel-ip-country') || null,
      city: decodeURIComponent(pick(h, 'x-vercel-ip-city') || '') || null,
      region: pick(h, 'x-vercel-ip-country-region') || null,
      device,
      browser,
      os,
      lang: (typeof body.lang === 'string' ? body.lang.slice(0, 12) : null) || (pick(h, 'accept-language').split(',')[0] || null),
      visitor_hash: visitorHash,
      is_bot: isBot,
    };

    // Fire-and-forget insert via PostgREST (anon, RLS insert-only).
    await fetch(supaUrl.replace(/\/$/, '') + '/rest/v1/web_pageviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: 'Bearer ' + anon,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });

    return res.status(204).end();
  } catch (err) {
    // Analytics must never surface errors to visitors.
    return res.status(204).end();
  }
};
