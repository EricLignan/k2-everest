/* K2 — Cloudflare Pages Function (API catch-all)
 * Handles all /api/* routes as a Pages Function
 * Bindings: env.K2_STATE (KV), env.HUBSPOT_TOKEN, env.JWT_SECRET, env.ADMIN_PIN, env.TEAM_PIN
 */

// ===== MINI JWT (HS256) =====
async function signJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${data}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(data));
  if (!valid) return null;
  const payload = JSON.parse(atob(parts[1]));
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// ===== RESPONSE HELPERS =====
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===== DEFAULT CHECKLIST =====
const DEFAULT_CHECKLIST = [
  { id: 'sono', label: 'Verifier sono + micro', section: 'avant', done: false, timestamp: null },
  { id: 'chaises', label: 'Installer chaises', section: 'avant', done: false, timestamp: null },
  { id: 'accueil_artistes', label: 'Accueillir artistes', section: 'avant', done: false, timestamp: null },
  { id: 'briefing', label: 'Briefing collectif', section: 'avant', done: false, timestamp: null },
  { id: 'ecrans', label: 'Tester ecrans', section: 'avant', done: false, timestamp: null },
  { id: 'lancer_mc', label: 'Lancer le MC', section: 'show', done: false, timestamp: null },
  { id: 'timer', label: 'Timer passages (5 min)', section: 'show', done: false, timestamp: null },
  { id: 'torche', label: 'Torche 1 min restante', section: 'show', done: false, timestamp: null },
  { id: 'chapeau_encaisser', label: 'Encaisser chapeau', section: 'apres', done: false, timestamp: null },
  { id: 'compter', label: 'Compter total', section: 'apres', done: false, timestamp: null },
  { id: 'photo', label: 'Photo groupe artistes', section: 'apres', done: false, timestamp: null },
  { id: 'merci', label: 'Remercier spectateurs', section: 'apres', done: false, timestamp: null },
];

// ===== MAIN HANDLER =====
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // OPTIONS preflight — Pages handles CORS, but just in case
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    // --- Public routes ---
    if (path === '/api/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (path === '/api/auth' && request.method === 'POST') {
      return handleAuth(request, env);
    }

    // --- Auth required ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Non autorise' }, 401);
    }
    const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
    if (!payload) {
      return json({ error: 'Token invalide ou expire' }, 401);
    }

    // --- Route dispatch ---
    if (path === '/api/session') return handleSession(env);
    if (path === '/api/lineup') return handleLineup(url, env);
    if (path === '/api/spectateurs') return handleSpectateurs(env);
    if (path === '/api/stats') return handleStats(env);
    if (path === '/api/checklist') {
      return request.method === 'POST' ? handleChecklistPost(request, env, payload) : handleChecklistGet(url, env);
    }
    if (path === '/api/checkin') return handleCheckin(request, env, payload);
    if (path === '/api/chapeau') return handleChapeau(request, env, payload);
    if (path === '/api/paiements') {
      return request.method === 'POST' ? handlePaiementsPost(request, env, payload) : handlePaiementsGet(url, env);
    }

    return json({ error: 'Route inconnue' }, 404);
  } catch (err) {
    console.error('API error:', err);
    return json({ error: err.message || 'Erreur serveur' }, 500);
  }
}

// ===== AUTH =====
async function handleAuth(request, env) {
  const body = await request.json();
  const pin = String(body.pin || '');

  const rateLimitKey = `ratelimit:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const attempts = parseInt(await env.K2_STATE.get(rateLimitKey) || '0');
  if (attempts >= 10) {
    return json({ error: 'Trop de tentatives, reessayez dans 5 min' }, 429);
  }

  let role = null;
  if (pin === env.ADMIN_PIN) role = 'admin';
  else if (pin === env.TEAM_PIN) role = 'team';

  if (!role) {
    await env.K2_STATE.put(rateLimitKey, String(attempts + 1), { expirationTtl: 300 });
    return json({ error: 'PIN invalide' }, 401);
  }

  await env.K2_STATE.delete(rateLimitKey);
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const token = await signJWT({ role, exp }, env.JWT_SECRET);
  return json({ token, role, expires: new Date(exp * 1000).toISOString() });
}

// ===== SESSION =====
async function handleSession(env) {
  return json({
    date: '2026-04-08',
    jour: 'mardi',
    heure: '19h30',
    phase: 'init',
    j_minus: Math.ceil((new Date('2026-04-08') - new Date()) / 86400000),
    mc: null,
    lineup_count: 0,
    lineup_target: 10,
    spectateurs_inscrits: 0,
    parity_pct: 0,
    primo_count: 0,
    checklist: { done: 0, total: 12 },
    actions: [
      { id: 'dispos', label: 'Collecter les disponibilites', done: false },
      { id: 'lineup', label: 'Selectionner le lineup', done: false },
      { id: 'email_confirm', label: 'Envoyer email confirmation', done: false },
    ],
    last_updated: new Date().toISOString(),
  });
}

// ===== LINEUP =====
async function handleLineup(url, env) {
  const date = url.searchParams.get('date') || '2026-04-08';
  return json({ date, artistes: [], remplacants: [], parity_pct: 0, confirmed_count: 0, target: 10 });
}

// ===== SPECTATEURS =====
async function handleSpectateurs(env) {
  return json({ inscrits: 0, last_updated: new Date().toISOString() });
}

// ===== STATS =====
async function handleStats(env) {
  return json({
    sessions: [],
    totals: { sessions_count: 0, avg_spectateurs: 0, avg_chapeau: 0, total_artistes_uniques: 0, trend_spectateurs_pct: 0, avg_parity: 0 },
  });
}

// ===== CHECKLIST =====
async function handleChecklistGet(url, env) {
  const date = url.searchParams.get('date') || '2026-04-08';
  const stored = await env.K2_STATE.get(`checklist:${date}`);
  return json({ items: stored ? JSON.parse(stored) : DEFAULT_CHECKLIST });
}

async function handleChecklistPost(request, env, payload) {
  const { date, item_id, done } = await request.json();
  if (!date || !item_id) return json({ error: 'date et item_id requis' }, 400);

  const key = `checklist:${date}`;
  const stored = await env.K2_STATE.get(key);
  const items = stored ? JSON.parse(stored) : structuredClone(DEFAULT_CHECKLIST);
  const item = items.find(i => i.id === item_id);
  if (item) {
    item.done = !!done;
    item.timestamp = done ? new Date().toISOString() : null;
  }
  await env.K2_STATE.put(key, JSON.stringify(items));
  return json({ ok: true, timestamp: item?.timestamp });
}

// ===== CHECKIN =====
async function handleCheckin(request, env, payload) {
  const { date, artiste, present } = await request.json();
  if (!date || !artiste) return json({ error: 'date et artiste requis' }, 400);

  const key = `pointage:${date}`;
  const stored = await env.K2_STATE.get(key);
  const pointage = stored ? JSON.parse(stored) : {};
  pointage[artiste] = { present: !!present, timestamp: new Date().toISOString() };
  await env.K2_STATE.put(key, JSON.stringify(pointage));

  const presents = Object.values(pointage).filter(p => p.present).length;
  return json({ ok: true, presents, total: Object.keys(pointage).length });
}

// ===== CHAPEAU =====
async function handleChapeau(request, env, payload) {
  if (payload.role !== 'admin') return json({ error: 'Admin requis' }, 403);

  const { date, total, nb_artistes } = await request.json();
  if (!date || !total || !nb_artistes) return json({ error: 'date, total et nb_artistes requis' }, 400);

  const caisse = Math.round(total * 0.1 * 100) / 100;
  const parArtiste = Math.round((total * 0.9 / nb_artistes) * 100) / 100;
  const chapeau = { total, nb_artistes, caisse_solidarite: caisse, par_artiste: parArtiste };
  await env.K2_STATE.put(`chapeau:${date}`, JSON.stringify(chapeau));
  return json({ ok: true, ...chapeau });
}

// ===== PAIEMENTS =====
async function handlePaiementsGet(url, env) {
  const date = url.searchParams.get('date') || '2026-04-08';
  const stored = await env.K2_STATE.get(`paiements:${date}`);
  return json(stored ? JSON.parse(stored) : { artistes: [] });
}

async function handlePaiementsPost(request, env, payload) {
  if (payload.role !== 'admin') return json({ error: 'Admin requis' }, 403);

  const { date, artiste, paye } = await request.json();
  if (!date || !artiste) return json({ error: 'date et artiste requis' }, 400);

  const key = `paiements:${date}`;
  const stored = await env.K2_STATE.get(key);
  const data = stored ? JSON.parse(stored) : { artistes: [] };
  const art = data.artistes.find(a => a.name === artiste);
  if (art) {
    art.paye = !!paye;
    art.date_paiement = paye ? new Date().toISOString().slice(0, 10) : null;
  }
  await env.K2_STATE.put(key, JSON.stringify(data));
  return json({ ok: true });
}
