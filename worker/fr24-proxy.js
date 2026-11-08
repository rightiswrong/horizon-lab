// Minimal Cloudflare Worker that lets the browser game call the Flightradar24 API.
//
// Why: browsers only allow cross-site API calls when the API answers with CORS headers.
// This Worker adds them, and (optionally) holds your FR24 key as a secret so it never
// ships to the browser.
//
// Deploy:   npm i -g wrangler && cd worker && wrangler deploy
// Secret:   wrangler secret put FR24_API_KEY        (optional — otherwise the page sends the user's key)
// Origins:  set ALLOWED_ORIGINS in wrangler.toml to your GitHub Pages origin.
//
// Only read-only live-position endpoints (and sandbox equivalents) are forwarded, so a leaked
// proxy URL can't be used to query other, more expensive endpoints.

const UPSTREAM = 'https://fr24api.flightradar24.com';
const ALLOWED_PATH = /^\/api\/(sandbox\/)?live\/flight-positions\/(light|full|count)$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowList = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowList.includes('*') || allowList.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? (allowList.includes('*') ? '*' : origin) : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Accept, Accept-Version',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originOk) return json({ message: 'Origin not allowed. Add it to ALLOWED_ORIGINS.' }, 403, cors);
    if (request.method !== 'GET') return json({ message: 'Method not allowed' }, 405, cors);

    const url = new URL(request.url);
    if (!ALLOWED_PATH.test(url.pathname)) return json({ message: 'Endpoint not allowed by proxy' }, 404, cors);

    // A server-side secret wins over anything the browser sends.
    const auth = env.FR24_API_KEY ? `Bearer ${env.FR24_API_KEY}` : request.headers.get('Authorization');
    if (!auth) return json({ message: 'No API key: set the FR24_API_KEY secret or enter a key in the app.' }, 401, cors);

    const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
      headers: { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: auth },
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'no-store');
    const ra = upstream.headers.get('Retry-After');
    if (ra) headers.set('Retry-After', ra);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
