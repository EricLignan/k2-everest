/* K2 — Cloudflare Worker (API Proxy) */

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

// ===== CORS =====
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ===== HUBSPOT API =====
async function hubspotGet(path, token) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

// ===== GITHUB RAW =====
async function githubRaw(owner, repo, path, token) {
  const headers = { Accept: 'application/vnd.github.v3.raw' };
  if (token) headers.Authorization = `token ${token}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers });
  if (!res.ok) return null;
  return res.text();
}

// ===== SIMPLE YAML PARSER (for session files) =====
function parseSimpleYAML(text) {
  if (!text) return {};
  const result = {};
  let currentKey = null;
  let currentList = null;
  let currentObj = null;
  let inList = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Top-level key: value
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '' || val === '[]') {
        result[currentKey] = [];
        inList = true;
        currentList = result[currentKey];
      } else {
        result[currentKey] = parseValue(val);
        inList = false;
        currentList = null;
      }
      currentObj = null;
      continue;
    }

    // List item
    if (line.match(/^\s+-\s+/)) {
      const itemKV = line.match(/^\s+-\s+(\w[\w_]*)\s*:\s*(.*)$/);
      if (itemKV && currentList) {
        currentObj = {};
        currentObj[itemKV[1]] = parseValue(itemKV[2].trim());
        currentList.push(currentObj);
      }
      continue;
    }

    // Continuation of list item object
    if (line.match(/^\s+\w/) && currentObj) {
      const subKV = line.match(/^\s+(\w[\w_]*)\s*:\s*(.*)$/);
      if (subKV) {
        currentObj[subKV[1]] = parseValue(subKV[2].trim());
      }
    }
  }
  return result;
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return parseInt(v);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  // Remove quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

// ===== MAIN HANDLER =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Router
    try {
      const path = url.pathname;

      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, 200, origin);
      }

      if (path === '/api/auth' && request.method === 'POST') {
        return handleAuth(request, env, origin);
      }

      // All other routes require auth
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Non autorise' }, 401, origin);
      }

      const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
      if (!payload) {
        return jsonResponse({ error: 'Token invalide ou expire' }, 401, origin);
      }

      // Route dispatch
      switch (path) {
        case '/api/session':
          return handleSession(env, origin);
        case '/api/lineup':
          return handleLineup(url, env, origin);
        case '/api/spectateurs':
          return handleSpectateurs(env, origin);
        case '/api/stats':
          return handleStats(env, origin);
        case '/api/checklist':
          return request.method === 'POST'
            ? handleChecklistPost(request, env, payload, origin)
            : handleChecklistGet(url, env, origin);
        case '/api/checkin':
          return handleCheckin(request, env, payload, origin);
        case '/api/chapeau':
          return handleChapeau(request, env, payload, origin);
        case '/api/paiements':
          return request.method === 'POST'
            ? handlePaiementsPost(request, env, payload, origin)
            : handlePaiementsGet(url, env, origin);
        default:
          return jsonResponse({ error: 'Route inconnue' }, 404, origin);
      }
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: err.message || 'Erreur serveur' }, 500, origin);
    }
  },
};

// ===== HANDLERS =====

async function handleAuth(request, env, origin) {
  const body = await request.json();
  const pin = String(body.pin || '');

  // Rate limiting via KV
  const rateLimitKey = `ratelimit:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const attempts = parseInt(await env.K2_STATE.get(rateLimitKey) || '0');
  if (attempts >= 10) {
    return jsonResponse({ error: 'Trop de tentatives, reessayez dans 5 min' }, 429, origin);
  }

  let role = null;
  if (pin === env.ADMIN_PIN) role = 'admin';
  else if (pin === env.TEAM_PIN) role = 'team';

  if (!role) {
    await env.K2_STATE.put(rateLimitKey, String(attempts + 1), { expirationTtl: 300 });
    return jsonResponse({ error: 'PIN invalide' }, 401, origin);
  }

  // Reset rate limit on success
  await env.K2_STATE.delete(rateLimitKey);

  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 days
  const token = await signJWT({ role, exp }, env.JWT_SECRET);
  return jsonResponse({ token, role, expires: new Date(exp * 1000).toISOString() }, 200, origin);
}

async function handleSession(env, origin) {
  // Read index.yaml to find active session
  const indexYaml = await githubRaw('EricLignan', 'k2-everest', 'data/index.yaml', env.GITHUB_TOKEN);
  if (!indexYaml) {
    // Fallback: try the main Everest repo
    const indexFromEverest = await githubRaw('EricLignan', 'everest-sessions', 'index.yaml', env.GITHUB_TOKEN);
    if (!indexFromEverest) {
      return jsonResponse({ error: 'index.yaml introuvable', phase: 'init', date: null }, 200, origin);
    }
  }

  // For now, return a placeholder that the front-end can display
  // TODO: parse index.yaml, find active session, read session YAML, merge with HubSpot
  return jsonResponse({
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
  }, 200, origin);
}

async function handleLineup(url, env, origin) {
  const date = url.searchParams.get('date') || '2026-04-08';
  // TODO: read session YAML + merge HubSpot contacts
  return jsonResponse({
    date,
    artistes: [],
    remplacants: [],
    parity_pct: 0,
    confirmed_count: 0,
    target: 10,
  }, 200, origin);
}

async function handleSpectateurs(env, origin) {
  // TODO: read HubSpot list 6
  return jsonResponse({ inscrits: 0, last_updated: new Date().toISOString() }, 200, origin);
}

async function handleStats(env, origin) {
  // TODO: aggregate from session YAMLs
  return jsonResponse({
    sessions: [],
    totals: { sessions_count: 0, avg_spectateurs: 0, avg_chapeau: 0, total_artistes_uniques: 0, trend_spectateurs_pct: 0, avg_parity: 0 },
  }, 200, origin);
}

// ===== DEFAULT CHECKLIST ITEMS =====
const DEFAULT_CHECKLIST = [
  { id: 'sono', label: 'Verifier sono + micro', section: 'avant', done: false, timestamp: null },
  { id: 'chaises', label: 'Installer chaises', section: 'avant', done: false, timestamp: null },
  { id: 'accueil_artistes', label: 'Accueillir artistes', section: 'avant', done: false, timestamp: null },
  { id: 'briefing', label: 'Briefing collectif', section: 'avant', done: false, timestamp: null },
  { id: 'ecrans', label: 'Tester ecrans', section: 'avant', done: false, timestamp: null },
  { id: 'lancer_mc', label: 'Lancer le MC', section: 'show', done: false, timestamp: null },
  { id: 'timer', label: 'Timer passages (5 min)', section: 'show', done: false, timestamp: null },
  { id: 'torche', label: 'Torche 1 min restante', section: 'show', done: false, timestamp: null },
  { id: 'chapeau', label: 'Encaisser chapeau', section: 'apres', done: false, timestamp: null },
  { id: 'compter', label: 'Compter total', section: 'apres', done: false, timestamp: null },
  { id: 'photo', label: 'Photo groupe artistes', section: 'apres', done: false, timestamp: null },
  { id: 'merci', label: 'Remercier spectateurs', section: 'apres', done: false, timestamp: null },
];

async function handleChecklistGet(url, env, origin) {
  const date = url.searchParams.get('date') || '2026-04-08';
  const stored = await env.K2_STATE.get(`checklist:${date}`);
  const items = stored ? JSON.parse(stored) : DEFAULT_CHECKLIST;
  return jsonResponse({ items }, 200, origin);
}

async function handleChecklistPost(request, env, payload, origin) {
  const body = await request.json();
  const { date, item_id, done } = body;
  if (!date || !item_id) return jsonResponse({ error: 'date et item_id requis' }, 400, origin);

  const key = `checklist:${date}`;
  const stored = await env.K2_STATE.get(key);
  const items = stored ? JSON.parse(stored) : [...DEFAULT_CHECKLIST];
  const item = items.find(i => i.id === item_id);
  if (item) {
    item.done = !!done;
    item.timestamp = done ? new Date().toISOString() : null;
  }
  await env.K2_STATE.put(key, JSON.stringify(items));
  return jsonResponse({ ok: true, timestamp: item?.timestamp }, 200, origin);
}

async function handleCheckin(request, env, payload, origin) {
  const body = await request.json();
  const { date, artiste, present } = body;
  if (!date || !artiste) return jsonResponse({ error: 'date et artiste requis' }, 400, origin);

  const key = `pointage:${date}`;
  const stored = await env.K2_STATE.get(key);
  const pointage = stored ? JSON.parse(stored) : {};
  pointage[artiste] = { present: !!present, timestamp: new Date().toISOString() };
  await env.K2_STATE.put(key, JSON.stringify(pointage));

  const presents = Object.values(pointage).filter(p => p.present).length;
  return jsonResponse({ ok: true, presents, total: Object.keys(pointage).length }, 200, origin);
}

async function handleChapeau(request, env, payload, origin) {
  if (payload.role !== 'admin') return jsonResponse({ error: 'Admin requis' }, 403, origin);

  const body = await request.json();
  const { date, total, nb_artistes } = body;
  if (!date || !total || !nb_artistes) return jsonResponse({ error: 'date, total et nb_artistes requis' }, 400, origin);

  const caisse = Math.round(total * 0.1 * 100) / 100;
  const parArtiste = Math.round((total * 0.9 / nb_artistes) * 100) / 100;

  const chapeau = { total, nb_artistes, caisse_solidarite: caisse, par_artiste: parArtiste };
  await env.K2_STATE.put(`chapeau:${date}`, JSON.stringify(chapeau));
  return jsonResponse({ ok: true, ...chapeau }, 200, origin);
}

async function handlePaiementsGet(url, env, origin) {
  const date = url.searchParams.get('date') || '2026-04-08';
  const stored = await env.K2_STATE.get(`paiements:${date}`);
  const data = stored ? JSON.parse(stored) : { artistes: [] };
  return jsonResponse(data, 200, origin);
}

async function handlePaiementsPost(request, env, payload, origin) {
  if (payload.role !== 'admin') return jsonResponse({ error: 'Admin requis' }, 403, origin);

  const body = await request.json();
  const { date, artiste, paye } = body;
  if (!date || !artiste) return jsonResponse({ error: 'date et artiste requis' }, 400, origin);

  const key = `paiements:${date}`;
  const stored = await env.K2_STATE.get(key);
  const data = stored ? JSON.parse(stored) : { artistes: [] };
  const art = data.artistes.find(a => a.name === artiste);
  if (art) {
    art.paye = !!paye;
    art.date_paiement = paye ? new Date().toISOString().slice(0, 10) : null;
  }
  await env.K2_STATE.put(key, JSON.stringify(data));
  return jsonResponse({ ok: true }, 200, origin);
}
