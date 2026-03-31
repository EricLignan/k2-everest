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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    // --- Public routes ---
    if (path === '/api/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Temporary debug endpoint
    if (path === '/api/debug') {
      const data = await loadSessions(env);
      const sessions = data.sessions || [];
      // Also test what paiements endpoint would return for each session
      const paiementsDebug = {};
      for (const s of sessions) {
        const kvData = await env.K2_STATE.get(`paiements:${s.date}`);
        paiementsDebug[s.date] = {
          from_kv: kvData ? JSON.parse(kvData) : null,
          from_json: (s.paiements || []).length,
          kv_wins: !!kvData,
        };
      }
      return json({
        sessions_count: sessions.length,
        sessions: sessions.map(s => ({
          date: s.date, phase: s.phase,
          lineup: s.lineup?.length || 0,
          paiements: s.paiements?.length || 0,
          remplacants: s.remplacants?.length || 0,
          mc: s.mc || null,
          has_ig: (s.lineup || []).filter(a => a.instagram).length,
        })),
        paiements_debug: paiementsDebug,
        has_assets: !!env.ASSETS,
        timestamp: new Date().toISOString(),
      });
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
    if (path === '/api/session') return handleSession(env, url);
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
    if (path === '/api/mc') return handleMcToggle(request, env, payload);

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

// ===== LOAD SESSIONS DATA =====
async function loadSessions(env) {
  // Strategy 1: ASSETS binding (direct, no CDN cache)
  try {
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(new Request('https://k2-everest.pages.dev/data/sessions.json'));
      if (res.ok) {
        const data = await res.json();
        if (data.sessions?.length) return data;
      }
    }
  } catch (e) {
    // ASSETS failed, try fallback
  }

  // Strategy 2: regular fetch with cache bypass
  try {
    const res = await fetch(`https://k2-everest.pages.dev/data/sessions.json`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.sessions?.length) return data;
    }
  } catch (e) {
    // fetch also failed
  }

  return { sessions: [] };
}

function findActiveSession(sessions) {
  const active = sessions.filter(s => !['archive', 'annule'].includes(s.phase));
  if (active.length > 0) return active[active.length - 1];
  return sessions[sessions.length - 1];
}

function findSessionByDate(sessions, date) {
  return sessions.find(s => s.date === date);
}

// ===== SESSION =====
async function handleSession(env, url) {
  const data = await loadSessions(env);
  const requestedDate = url?.searchParams?.get('date');
  const session = requestedDate
    ? findSessionByDate(data.sessions, requestedDate) || findActiveSession(data.sessions)
    : findActiveSession(data.sessions);

  if (!session) return json({ error: 'Aucune session trouvee', phase: 'init' });

  const today = new Date();
  const sessionDate = new Date(session.date + 'T00:00:00');
  const jMinus = Math.ceil((sessionDate - today) / 86400000);

  const lineup = session.lineup || [];
  const confirmed = lineup.filter(a => a.status === 'confirmed');
  const femmes = confirmed.filter(a => a.genre === 'F');
  const primos = confirmed.filter(a => a.primo);

  // Read checklist state from KV — for closed sessions, everything is done
  const isClosed = ['bilan', 'archive', 'annule'].includes(session.phase);
  let checklistItems;
  if (isClosed) {
    checklistItems = DEFAULT_CHECKLIST.map(i => ({ ...i, done: true }));
  } else {
    const checklistStored = await env.K2_STATE.get(`checklist:${session.date}`);
    checklistItems = checklistStored ? JSON.parse(checklistStored) : DEFAULT_CHECKLIST;
  }
  const checklistDone = checklistItems.filter(i => i.done).length;

  // Read MC override from KV (toggle MC feature)
  const mcOverride = await env.K2_STATE.get(`mc:${session.date}`);
  const mc = mcOverride || session.mc || null;

  return json({
    date: session.date,
    jour: session.jour,
    heure: session.heure,
    phase: session.phase,
    j_minus: jMinus,
    mc,
    lineup_count: confirmed.length,
    lineup_target: 10,
    spectateurs_inscrits: session.spectateurs || 0,
    parity_pct: confirmed.length > 0 ? Math.round(femmes.length / confirmed.length * 100) : 0,
    primo_count: primos.length,
    checklist: { done: checklistDone, total: checklistItems.length },
    actions: buildActions(session),
    last_updated: new Date().toISOString(),
  });
}

function buildActions(session) {
  const phase = session.phase;
  const hasLineup = session.lineup?.length > 0;
  const confirmedCount = (session.lineup || []).filter(a => a.status === 'confirmed').length;
  const pendingCount = (session.lineup || []).filter(a => a.status !== 'confirmed' && a.status !== 'declined').length;
  const HUBSPOT_EMAILS = 'https://app-eu1.hubspot.com/email/143993525/manage/draft';
  const HUBSPOT_CRM = 'https://app-eu1.hubspot.com/contacts/143993525/objects/0-1/views/all/list';
  const IG = 'https://www.instagram.com/everestcomedyclub/';

  const actions = [];

  // --- Phase INIT ---
  if (phase === 'init') {
    actions.push({ id: 'init-yaml', label: 'Creer la session (YAML + date)', done: false, url: null, category: 'setup' });
  }

  // --- Phase DISPOS ---
  if (phase === 'dispos' || phase === 'init') {
    actions.push(
      { id: 'email-dispos', label: '📧 Envoyer email dispos artistes', done: phase !== 'dispos' && phase !== 'init', url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'ig-story-dispos', label: '📸 Story IG : "Session le X, inscrivez-vous"', done: false, url: IG, category: 'instagram' },
      { id: 'dm-orphelins', label: '💬 DM Instagram aux nouveaux artistes', done: false, url: null, category: 'instagram' },
    );
  }

  // --- Phase SELECTION ---
  if (phase === 'dispos' || phase === 'selection') {
    actions.push(
      { id: 'select-lineup', label: `🎯 Selectionner le lineup (${confirmedCount}/10)`, done: hasLineup, url: null, category: 'lineup' },
    );
  }

  // --- Phase CONFIRMATION ---
  if (phase === 'selection' || phase === 'confirmation' || (phase === 'dispos' && hasLineup)) {
    actions.push(
      { id: 'email-confirm', label: '📧 Envoyer confirmation artistes (OUI/NON)', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'email-non-retenu', label: '📧 Envoyer email non-retenus', done: false, url: HUBSPOT_EMAILS, category: 'email' },
    );
    if (pendingCount > 0) {
      actions.push({ id: 'relance-dm', label: `💬 Relancer ${pendingCount} artiste(s) sans reponse (DM IG)`, done: false, url: null, category: 'instagram' });
    }
  }

  // --- Phase ANNONCE ---
  if (phase === 'confirmation' || phase === 'annonce') {
    actions.push(
      { id: 'email-spectateurs', label: '📧 Envoyer invitation spectateurs', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'ig-post-lineup', label: '📸 Post IG : visuel lineup (C/S)', done: false, url: IG, category: 'instagram' },
      { id: 'ig-story-lineup', label: '📸 Story IG : "Lineup revele !"', done: false, url: IG, category: 'instagram' },
    );
  }

  // --- Phase J-1 ---
  if (phase === 'annonce' || phase === 'j-1') {
    actions.push(
      { id: 'email-rappel-j2', label: '📧 Rappel J-2 spectateurs', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'email-rappel-j1', label: '📧 Rappel J-1 spectateurs + artistes', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'email-brief', label: '📧 Brief equipe (C/S + bar)', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'ig-story-j1', label: '📸 Story IG : "C\'est demain !"', done: false, url: IG, category: 'instagram' },
    );
  }

  // --- Phase SOIREE ---
  if (phase === 'soiree' || phase === 'j-1') {
    actions.push(
      { id: 'checklist', label: '✅ Checklist Jour J (onglet Jour J)', done: false, url: null, category: 'jour-j' },
      { id: 'ig-live', label: '📸 Story/live IG pendant le show', done: false, url: IG, category: 'instagram' },
    );
  }

  // --- Phase BILAN ---
  if (phase === 'bilan') {
    actions.push(
      { id: 'email-merci', label: '📧 Email merci spectateurs + chapeau', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'email-artistes-chapeau', label: '📧 Email artistes : bilan chapeau', done: false, url: HUBSPOT_EMAILS, category: 'email' },
      { id: 'ig-post-recap', label: '📸 Post IG : recap + remerciements', done: false, url: IG, category: 'instagram' },
      { id: 'paiements', label: '💰 Payer les artistes (onglet Paie)', done: false, url: null, category: 'paiement' },
    );
  }

  // --- Toujours visible : lien CRM ---
  if (!['archive', 'annule'].includes(phase)) {
    actions.push({ id: 'hubspot', label: '🔗 Ouvrir HubSpot CRM', done: false, url: HUBSPOT_CRM, category: 'lien' });
  }

  return actions;
}

// ===== LINEUP =====
async function handleLineup(url, env) {
  const data = await loadSessions(env);
  const date = url.searchParams.get('date');
  const session = date
    ? findSessionByDate(data.sessions, date) || findActiveSession(data.sessions)
    : findActiveSession(data.sessions);

  if (!session) return json({ date, artistes: [], remplacants: [], parity_pct: 0, confirmed_count: 0, target: 10 });

  // Read MC override from KV
  const mcOverride = await env.K2_STATE.get(`mc:${session.date}`);
  const mc = mcOverride || session.mc || null;

  const artistes = (session.lineup || []).map(a => ({
    ...a,
    is_mc: a.is_mc || a.name === mc,
    dm_text: buildDmText(a, session),
  }));

  // Load pointage from KV
  const pointageStored = await env.K2_STATE.get(`pointage:${session.date}`);
  const pointage = pointageStored ? JSON.parse(pointageStored) : {};
  artistes.forEach(a => {
    if (pointage[a.name]) a.present = pointage[a.name].present;
  });

  const confirmed = artistes.filter(a => a.status === 'confirmed');
  const femmes = confirmed.filter(a => a.genre === 'F');

  // Remplacants with phone/instagram
  const remplacants = (session.remplacants || []).map(r => ({
    ...r,
    dm_text: buildDmText(r, session, true),
  }));

  return json({
    date: session.date,
    artistes,
    remplacants,
    parity_pct: confirmed.length > 0 ? Math.round(femmes.length / confirmed.length * 100) : 0,
    confirmed_count: confirmed.length,
    target: 10,
  });
}

function buildDmText(artist, session, isRemplacant = false) {
  const name = artist.name || '?';
  const prefix = isRemplacant ? '(Remplacant) ' : '';
  return `Salut ${name} ! ${prefix}Tu es confirme(e) pour le Comedy Club Everest !\n${session.jour || ''} ${session.date} a ${session.heure || '19h30'}\nL'Everest Bar Beaubourg\n${artist.order ? 'Passage #' + artist.order + '\n' : ''}Arrive vers 19h00 pour le briefing.\nA bientot !`;
}

// ===== SPECTATEURS =====
async function handleSpectateurs(env) {
  return json({ inscrits: 0, last_updated: new Date().toISOString() });
}

// ===== STATS =====
async function handleStats(env) {
  const data = await loadSessions(env);
  const validSessions = data.sessions.filter(s => !s.annulee && s.phase !== 'init');

  // Count unique artists across all sessions
  const artistSet = new Set();
  data.sessions.forEach(s => {
    (s.lineup || []).forEach(a => {
      if (a.status === 'confirmed') artistSet.add(a.name);
    });
  });

  const totals = {
    sessions_count: validSessions.length,
    avg_spectateurs: validSessions.length > 0 ? Math.round(validSessions.reduce((s, x) => s + (x.spectateurs || 0), 0) / validSessions.length) : 0,
    avg_chapeau: validSessions.length > 0 ? Math.round(validSessions.reduce((s, x) => s + (x.chapeau || 0), 0) / validSessions.length) : 0,
    avg_parity: validSessions.length > 0 ? Math.round(validSessions.reduce((s, x) => s + (x.parity_pct || 0), 0) / validSessions.length) : 0,
    total_artistes_uniques: artistSet.size,
    trend_spectateurs_pct: 0,
  };

  if (validSessions.length >= 2) {
    const last = validSessions[validSessions.length - 1].spectateurs || 0;
    const prev = validSessions[validSessions.length - 2].spectateurs || 1;
    totals.trend_spectateurs_pct = Math.round((last - prev) / prev * 100);
  }

  return json({ sessions: data.sessions, totals });
}

// ===== CHECKLIST =====
async function handleChecklistGet(url, env) {
  const data = await loadSessions(env);
  const date = url.searchParams.get('date') || findActiveSession(data.sessions)?.date || '2026-04-08';
  const session = findSessionByDate(data.sessions, date);
  const isClosed = session && ['bilan', 'archive', 'annule'].includes(session.phase);

  if (isClosed) {
    return json({ items: DEFAULT_CHECKLIST.map(i => ({ ...i, done: true })) });
  }
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

  const { date, total, nb_artistes, especes, numerique } = await request.json();
  if (!date || !total || !nb_artistes) return json({ error: 'date, total et nb_artistes requis' }, 400);

  const caisse = Math.round(total * 0.1 * 100) / 100;
  const parArtiste = Math.round((total * 0.9 / nb_artistes) * 100) / 100;
  const chapeau = { total, nb_artistes, caisse_solidarite: caisse, par_artiste: parArtiste, especes: especes || 0, numerique: numerique || 0 };
  await env.K2_STATE.put(`chapeau:${date}`, JSON.stringify(chapeau));
  return json({ ok: true, ...chapeau });
}

// ===== PAIEMENTS =====
async function handlePaiementsGet(url, env) {
  const data = await loadSessions(env);
  const date = url.searchParams.get('date');
  const session = date
    ? findSessionByDate(data.sessions, date) || findActiveSession(data.sessions)
    : findActiveSession(data.sessions);

  // Try KV first (user-modified paiements) — but only if it has real data
  const stored = await env.K2_STATE.get(`paiements:${session?.date}`);
  if (stored) {
    const kvData = JSON.parse(stored);
    // Only use KV if it has actual artistes data (not empty from a bug)
    if (kvData.artistes?.length > 0) {
      return json(kvData);
    }
    // KV has empty data — delete it so sessions.json takes over
    await env.K2_STATE.delete(`paiements:${session?.date}`);
  }

  // From sessions.json (source of truth)
  return json({ artistes: session?.paiements || [] });
}

async function handlePaiementsPost(request, env, payload) {
  if (payload.role !== 'admin') return json({ error: 'Admin requis' }, 403);

  const { date, artiste, paye, mode } = await request.json();
  if (!date || !artiste) return json({ error: 'date et artiste requis' }, 400);

  const key = `paiements:${date}`;
  const stored = await env.K2_STATE.get(key);
  let data;
  if (stored) {
    data = JSON.parse(stored);
  } else {
    // Initialize from sessions.json
    const sessionsData = await loadSessions(env);
    const session = findSessionByDate(sessionsData.sessions, date) || {};
    data = { artistes: session.paiements || [] };
  }

  const art = data.artistes.find(a => a.name === artiste);
  if (art) {
    art.paye = !!paye;
    art.date_paiement = paye ? new Date().toISOString().slice(0, 10) : null;
    if (mode) art.mode = mode;
  }
  await env.K2_STATE.put(key, JSON.stringify(data));
  return json({ ok: true });
}

// ===== MC TOGGLE =====
async function handleMcToggle(request, env, payload) {
  if (request.method !== 'POST') return json({ error: 'POST requis' }, 405);

  const { date, artiste } = await request.json();
  if (!date || !artiste) return json({ error: 'date et artiste requis' }, 400);

  await env.K2_STATE.put(`mc:${date}`, artiste);
  return json({ ok: true, mc: artiste });
}
