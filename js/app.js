/* K2 — Main App */

const App = (() => {
  let state = {
    session: null,
    lineup: null,
    stats: null,
    checklist: null,
    paiements: null,
    currentView: 'dashboard',
    lastRefresh: null,
  };

  let refreshTimer = null;

  // ===== INIT =====
  function init() {
    if (API.isLoggedIn()) {
      showApp();
      loadAllData();
      startAutoRefresh();
    } else {
      showAuth();
    }

    setupRouting();
    setupTheme();
    setupOfflineDetection();
    setupPinPad();
    setupHeaderButtons();
    setupChapeauCalc();

    // Sync offline queue on reconnect
    window.addEventListener('online', () => {
      document.getElementById('offline-badge').classList.add('hidden');
      API.syncOfflineQueue().then(() => loadAllData());
    });
    window.addEventListener('offline', () => {
      document.getElementById('offline-badge').classList.remove('hidden');
    });
  }

  // ===== AUTH =====
  let pinBuffer = '';

  function showAuth() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('app').classList.add('hidden');
    pinBuffer = '';
    updatePinDots();
  }

  function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app').classList.remove('hidden');
  }

  function setupPinPad() {
    document.querySelector('.pin-pad').addEventListener('click', (e) => {
      const key = e.target.closest('.pin-key')?.dataset.key;
      if (!key) return;

      if (key === 'clear') {
        pinBuffer = '';
      } else if (key === 'back') {
        pinBuffer = pinBuffer.slice(0, -1);
      } else if (pinBuffer.length < 4) {
        pinBuffer += key;
      }

      updatePinDots();

      if (pinBuffer.length === 4) {
        attemptLogin(pinBuffer);
      }
    });
  }

  function updatePinDots() {
    document.querySelectorAll('.pin-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinBuffer.length);
    });
  }

  async function attemptLogin(pin) {
    const errEl = document.getElementById('pin-error');
    try {
      await API.login(pin);
      errEl.textContent = '';
      showApp();
      loadAllData();
      startAutoRefresh();
    } catch (err) {
      errEl.textContent = err.message || 'PIN invalide';
      pinBuffer = '';
      updatePinDots();
      // Shake animation
      document.querySelector('.pin-display').style.animation = 'none';
      requestAnimationFrame(() => {
        document.querySelector('.pin-display').style.animation = 'shake 0.3s';
      });
    }
  }

  // ===== ROUTING =====
  function setupRouting() {
    window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'dashboard'));
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        location.hash = view;
      });
    });
  }

  function navigate(view) {
    const validViews = ['dashboard', 'lineup', 'stats', 'checklist', 'paiements'];
    if (!validViews.includes(view)) view = 'dashboard';
    state.currentView = view;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === view);
    });
  }

  // ===== THEME =====
  function setupTheme() {
    const saved = localStorage.getItem('k2_theme');
    if (saved === 'light') document.body.classList.add('light-mode');
  }

  function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('k2_theme', isLight ? 'light' : 'dark');
    document.getElementById('btn-theme').textContent = isLight ? '☾' : '☀';
  }

  // ===== HEADER BUTTONS =====
  function setupHeaderButtons() {
    document.getElementById('btn-refresh').addEventListener('click', () => loadAllData(true));
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('btn-logout').addEventListener('click', API.logout);
  }

  // ===== OFFLINE =====
  function setupOfflineDetection() {
    if (!navigator.onLine) {
      document.getElementById('offline-badge').classList.remove('hidden');
    }
  }

  // ===== AUTO REFRESH =====
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadAllData(), 5 * 60 * 1000);  // 5 min
    updateLastRefreshDisplay();
    setInterval(updateLastRefreshDisplay, 30000);
  }

  function updateLastRefreshDisplay() {
    if (!state.lastRefresh) return;
    const ago = Math.round((Date.now() - state.lastRefresh) / 60000);
    const text = ago < 1 ? 'a l\'instant' : `il y a ${ago} min`;
    document.getElementById('last-updated').textContent = text;
  }

  // ===== DATA LOADING =====
  async function loadAllData(noCache = false) {
    try {
      const [session, stats] = await Promise.all([
        API.get('/api/session', noCache),
        API.get('/api/stats', noCache),
      ]);
      state.session = session;
      state.stats = stats;
      state.lastRefresh = Date.now();
      updateLastRefreshDisplay();

      renderDashboard();
      renderStats();

      // Load lineup if on that screen or for dashboard metrics
      if (session?.date) {
        const lineup = await API.get(`/api/lineup?date=${session.date}`, noCache);
        state.lineup = lineup;
        renderLineup();
      }

      // Load checklist
      if (session?.date) {
        const checklist = await API.get(`/api/checklist?date=${session.date}`, noCache);
        state.checklist = checklist;
        renderChecklist();
      }

      // Load paiements
      if (session?.date) {
        const paiements = await API.get(`/api/paiements?date=${session.date}`, noCache);
        state.paiements = paiements;
        renderPaiements();
      }
    } catch (err) {
      console.error('Load error:', err);
      toast('Erreur de chargement', 'error');
    }
  }

  // ===== RENDER: DASHBOARD =====
  function renderDashboard() {
    const s = state.session;
    if (!s) return;

    const phaseEl = document.getElementById('session-phase');
    phaseEl.textContent = s.phase?.toUpperCase() || '—';
    phaseEl.className = `session-phase-badge phase-${s.phase || 'init'}`;

    const jourMap = { lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche' };
    const dateStr = s.date ? new Date(s.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    document.getElementById('session-date').textContent = `${jourMap[s.jour] || s.jour || ''} ${dateStr}`;
    document.getElementById('session-countdown').textContent = s.j_minus != null ? `J-${s.j_minus}` : '';

    document.getElementById('m-confirmes').textContent = `${s.lineup_count ?? '—'}/${s.lineup_target ?? 10}`;
    document.getElementById('m-inscrits').textContent = s.spectateurs_inscrits ?? '—';
    document.getElementById('m-parite').textContent = s.parity_pct != null ? `${s.parity_pct}%` : '—';
    document.getElementById('m-primo').textContent = s.primo_count ?? '—';

    // Checklist progress
    const done = s.checklist?.done ?? 0;
    const total = s.checklist?.total ?? 12;
    document.getElementById('checklist-count').textContent = `${done}/${total}`;
    document.getElementById('checklist-fill').style.width = `${total > 0 ? (done / total * 100) : 0}%`;

    // Actions
    const actionsEl = document.getElementById('actions-items');
    if (s.actions?.length) {
      actionsEl.innerHTML = s.actions.map(a => `
        <div class="action-item">
          <div class="action-check ${a.done ? 'done' : ''}">${a.done ? '✓' : ''}</div>
          <span>${a.label}</span>
        </div>
      `).join('');
    } else {
      actionsEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Aucune action en attente</p>';
    }
  }

  // ===== RENDER: LINEUP =====
  function renderLineup() {
    const l = state.lineup;
    if (!l) return;

    document.getElementById('lineup-count').textContent = `${l.confirmed_count ?? 0}/${l.target ?? 10}`;

    const list = document.getElementById('lineup-list');
    list.innerHTML = (l.artistes || []).map(a => artistCard(a)).join('');

    const remp = document.getElementById('lineup-remplacants');
    if (l.remplacants?.length) {
      remp.innerHTML = l.remplacants.map(a => artistCard(a, true)).join('');
      remp.classList.remove('hidden');
    } else {
      remp.innerHTML = '';
    }

    // Copy all DM button
    document.getElementById('btn-copy-all-dm').onclick = () => {
      const allDm = (l.artistes || []).filter(a => a.dm_text).map(a => a.dm_text).join('\n---\n');
      copyToClipboard(allDm);
    };

    // Individual copy buttons
    list.querySelectorAll('.btn-copy-dm').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.dm);
      });
    });

    // Pointage (tap to toggle present/absent)
    list.querySelectorAll('.artist-card[data-artist]').forEach(card => {
      card.addEventListener('click', () => togglePresence(card.dataset.artist));
    });
  }

  function artistCard(a, isRemplacant = false) {
    const statusClass = a.present === true ? 'present' : a.present === false ? 'absent' : a.status || 'proposed';
    const statusLabel = a.present === true ? 'Present' : a.present === false ? 'Absent' :
      a.status === 'confirmed' ? 'Confirme' : a.status === 'declined' ? 'Decline' : 'En attente';

    return `
      <div class="artist-card" data-artist="${a.name || ''}">
        <div class="artist-order">${isRemplacant ? 'R' : a.order || '—'}</div>
        <div class="artist-info">
          <div class="artist-name">
            ${a.name || a.nom_de_scene || '?'}
            ${a.genre === 'F' ? '<span class="badge-genre">F</span>' : ''}
            ${a.is_mc ? '<span class="badge-mc">MC</span>' : ''}
          </div>
          <div class="artist-ig">${a.instagram ? '@' + a.instagram : ''}</div>
        </div>
        <span class="status-pill status-${statusClass}">${statusLabel}</span>
        ${a.dm_text ? `<button class="btn-copy-dm" data-dm="${escapeAttr(a.dm_text)}" title="Copier DM">📋</button>` : ''}
      </div>
    `;
  }

  async function togglePresence(artistName) {
    if (API.getRole() !== 'admin' && API.getRole() !== 'team') return;
    const date = state.session?.date;
    if (!date) return;

    // Find current state
    const artist = state.lineup?.artistes?.find(a => a.name === artistName);
    if (!artist) return;

    const newPresent = artist.present !== true;
    artist.present = newPresent;
    renderLineup();

    await API.post('/api/checkin', { date, artiste: artistName, present: newPresent });
    toast(newPresent ? `${artistName} present` : `${artistName} absent`);
  }

  // ===== RENDER: STATS =====
  function renderStats() {
    const s = state.stats;
    if (!s) return;

    Charts.barChart(document.getElementById('stats-chart'), s.sessions, {
      valueKey: 'spectateurs',
      barColor: '#e94560',
    });

    document.getElementById('s-chapeau-last').textContent = s.sessions?.length ? `${s.sessions[s.sessions.length - 1].chapeau || 0}€` : '—';
    document.getElementById('s-chapeau-avg').textContent = s.totals?.avg_chapeau ? `${Math.round(s.totals.avg_chapeau)}€` : '—';
    document.getElementById('s-parity-pct').textContent = `${s.totals?.avg_parity || 0}%`;
    document.getElementById('s-parity-fill').style.width = `${s.totals?.avg_parity || 0}%`;
    document.getElementById('s-pool').textContent = s.totals?.total_artistes_uniques ?? '—';
    document.getElementById('s-sessions').textContent = s.totals?.sessions_count ?? '—';
  }

  // ===== RENDER: CHECKLIST =====
  function renderChecklist() {
    const c = state.checklist;
    if (!c?.items) return;

    const isToday = state.session?.j_minus === 0;
    const liveEl = document.getElementById('checklist-live');
    liveEl.classList.toggle('hidden', !isToday);

    const sections = { avant: [], show: [], apres: [] };
    c.items.forEach(item => {
      (sections[item.section] || sections.avant).push(item);
    });

    const sectionLabels = { avant: 'Avant (18h30-19h15)', show: 'Show (19h30-20h25)', apres: 'Apres (20h25-21h00)' };
    const container = document.getElementById('checklist-sections');
    container.innerHTML = Object.entries(sections).map(([key, items]) => `
      <div class="checklist-section">
        <h3>${sectionLabels[key] || key}</h3>
        ${items.map(item => `
          <div class="checklist-item ${item.done ? 'done' : ''}" data-item-id="${item.id}">
            <div class="checklist-checkbox ${item.done ? 'checked' : ''}">${item.done ? '✓' : ''}</div>
            <span class="checklist-label">${item.label}</span>
            <span class="checklist-time">${item.timestamp ? new Date(item.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
        `).join('')}
      </div>
    `).join('');

    // Click handlers
    container.querySelectorAll('.checklist-item').forEach(el => {
      el.addEventListener('click', () => toggleChecklistItem(el.dataset.itemId));
    });
  }

  async function toggleChecklistItem(itemId) {
    const date = state.session?.date;
    if (!date) return;

    const item = state.checklist?.items?.find(i => i.id === itemId);
    if (!item) return;

    item.done = !item.done;
    item.timestamp = item.done ? new Date().toISOString() : null;
    renderChecklist();
    updateDashboardChecklist();

    await API.post('/api/checklist', { date, item_id: itemId, done: item.done });
  }

  function updateDashboardChecklist() {
    if (!state.checklist?.items) return;
    const done = state.checklist.items.filter(i => i.done).length;
    const total = state.checklist.items.length;
    document.getElementById('checklist-count').textContent = `${done}/${total}`;
    document.getElementById('checklist-fill').style.width = `${total > 0 ? (done / total * 100) : 0}%`;
  }

  // ===== CHAPEAU CALC =====
  function setupChapeauCalc() {
    const totalInput = document.getElementById('chapeau-total');
    const nbInput = document.getElementById('chapeau-nb');
    const resultEl = document.getElementById('chapeau-result');

    function calc() {
      const total = parseFloat(totalInput.value) || 0;
      const nb = parseInt(nbInput.value) || 0;
      if (total > 0 && nb > 0) {
        const caisse = Math.round(total * 0.1 * 100) / 100;
        const parArtiste = Math.round((total * 0.9 / nb) * 100) / 100;
        resultEl.innerHTML = `Caisse solidarite : <strong>${caisse}€</strong> | Par artiste : <strong>${parArtiste}€</strong>`;
      } else {
        resultEl.innerHTML = '';
      }
    }

    totalInput.addEventListener('input', calc);
    nbInput.addEventListener('input', calc);

    document.getElementById('btn-save-chapeau').addEventListener('click', async () => {
      const total = parseFloat(totalInput.value);
      const nb = parseInt(nbInput.value);
      const date = state.session?.date;
      if (!total || !nb || !date) { toast('Remplir total et nombre artistes', 'error'); return; }

      await API.post('/api/chapeau', { date, total, nb_artistes: nb });
      toast('Chapeau enregistre');
    });
  }

  // ===== RENDER: PAIEMENTS =====
  function renderPaiements() {
    const p = state.paiements;
    if (!p?.artistes?.length) {
      document.getElementById('paiements-summary').innerHTML = '<p style="color:var(--text-muted)">Aucun paiement</p>';
      document.getElementById('paiements-list').innerHTML = '';
      document.getElementById('paiements-count').textContent = '0/0';
      return;
    }

    const payes = p.artistes.filter(a => a.paye).length;
    const total = p.artistes.length;
    document.getElementById('paiements-count').textContent = `${payes}/${total}`;
    document.getElementById('paiements-summary').innerHTML = `
      <div class="metric-value">${p.artistes[0]?.montant || '—'}€</div>
      <div class="metric-label">par artiste</div>
    `;

    const list = document.getElementById('paiements-list');
    list.innerHTML = p.artistes.map(a => `
      <div class="paiement-card" data-artist="${a.name}">
        <div class="paiement-info">
          <div class="paiement-name">${a.name}</div>
          <div class="paiement-mode">${a.mode || '?'} ${a.date_paiement ? '— ' + a.date_paiement : ''}</div>
        </div>
        <span class="paiement-amount">${a.montant || '—'}€</span>
        <span class="status-pill ${a.paye ? 'status-confirmed' : 'status-proposed'}">${a.paye ? 'Paye' : 'En attente'}</span>
      </div>
    `).join('');

    // Click to toggle paid (admin only)
    if (API.getRole() === 'admin') {
      list.querySelectorAll('.paiement-card').forEach(card => {
        card.addEventListener('click', () => togglePaiement(card.dataset.artist));
      });
    }
  }

  async function togglePaiement(artistName) {
    const date = state.session?.date;
    if (!date) return;
    const artist = state.paiements?.artistes?.find(a => a.name === artistName);
    if (!artist) return;

    artist.paye = !artist.paye;
    artist.date_paiement = artist.paye ? new Date().toISOString().slice(0, 10) : null;
    renderPaiements();

    await API.post('/api/paiements', { date, artiste: artistName, paye: artist.paye });
    toast(artist.paye ? `${artistName} paye` : `${artistName} en attente`);
  }

  // ===== UTILS =====
  function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.background = type === 'error' ? 'var(--accent)' : 'var(--accent-green)';
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copie !'));
    } else {
      // Fallback for iOS
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Copie !');
    }
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ===== CSS SHAKE ANIMATION =====
  const style = document.createElement('style');
  style.textContent = '@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }';
  document.head.appendChild(style);

  // ===== START =====
  document.addEventListener('DOMContentLoaded', init);

  return { state, loadAllData };
})();
