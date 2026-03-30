/* K2 — Main App */

const App = (() => {
  let state = {
    session: null,
    lineup: null,
    stats: null,
    checklist: null,
    paiements: null,
    currentView: 'dashboard',
    selectedDate: null,
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
      // Load stats first (contains all sessions for the session picker)
      const stats = await API.get('/api/stats', noCache);
      state.stats = stats;

      // If no selectedDate, pick the most recent session with real data
      if (!state.selectedDate && stats?.sessions?.length) {
        const withData = stats.sessions.filter(s => !s.annulee && s.phase !== 'init');
        state.selectedDate = withData.length > 0 ? withData[withData.length - 1].date : stats.sessions[stats.sessions.length - 1].date;
      }

      const date = state.selectedDate;
      const [session, lineup, checklist, paiements] = await Promise.all([
        API.get(`/api/session${date ? '?date=' + date : ''}`, noCache),
        API.get(`/api/lineup?date=${date}`, noCache),
        API.get(`/api/checklist?date=${date}`, noCache),
        API.get(`/api/paiements?date=${date}`, noCache),
      ]);

      state.session = session;
      state.lineup = lineup;
      state.checklist = checklist;
      state.paiements = paiements;
      state.lastRefresh = Date.now();
      updateLastRefreshDisplay();

      renderSessionPicker();
      renderDashboard();
      renderLineup();
      renderStats();
      renderChecklist();
      renderPaiements();
    } catch (err) {
      console.error('Load error:', err);
      toast('Erreur de chargement', 'error');
    }
  }

  // ===== SESSION PICKER =====
  function renderSessionPicker() {
    const sessions = state.stats?.sessions?.filter(s => !s.annulee) || [];
    if (sessions.length <= 1) return;

    const picker = document.getElementById('session-picker');
    if (!picker) return;

    const moisCourts = ['', 'jan', 'fev', 'mar', 'avr', 'mai', 'jun', 'jul', 'aou', 'sep', 'oct', 'nov', 'dec'];
    picker.innerHTML = sessions.map(s => {
      const [, m, d] = s.date.split('-');
      const label = `${parseInt(d)} ${moisCourts[parseInt(m)]}`;
      const active = s.date === state.selectedDate;
      return `<button class="picker-btn ${active ? 'active' : ''}" data-date="${s.date}">${label}</button>`;
    }).join('');

    picker.querySelectorAll('.picker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedDate = btn.dataset.date;
        loadAllData();
      });
    });
  }

  // ===== HELPERS =====
  function isSessionClosed(session) {
    return ['bilan', 'archive', 'annule'].includes(session?.phase);
  }

  // ===== RENDER: DASHBOARD =====
  function renderDashboard() {
    const s = state.session;
    if (!s) return;
    const closed = isSessionClosed(s);

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

    // Health indicator
    const healthEl = document.getElementById('session-health');
    if (healthEl && !closed) {
      const risks = [];
      if ((s.lineup_count || 0) < 6) risks.push('Moins de 6 artistes');
      if ((s.parity_pct || 0) < 20) risks.push('Parite < 20%');
      if (s.j_minus <= 2 && (s.lineup_count || 0) < 8) risks.push('J-2 et lineup incomplet');
      const level = risks.length === 0 ? 'green' : risks.length <= 1 ? 'orange' : 'red';
      const labels = { green: 'OK', orange: 'Attention', red: 'A risque' };
      healthEl.className = `health-badge health-${level}`;
      healthEl.textContent = labels[level];
      healthEl.title = risks.join(', ') || 'Tout est bon';
    } else if (healthEl) {
      healthEl.className = 'health-badge hidden';
    }

    // Who's missing (non-closed only)
    const missingEl = document.getElementById('missing-artists');
    if (missingEl && !closed && state.lineup?.artistes) {
      const pending = state.lineup.artistes.filter(a => a.status !== 'confirmed' && a.status !== 'declined');
      if (pending.length > 0) {
        missingEl.innerHTML = `<strong>En attente :</strong> ${pending.map(a => a.name).join(', ')}`;
        missingEl.classList.remove('hidden');
      } else {
        missingEl.classList.add('hidden');
      }
    } else if (missingEl) {
      missingEl.classList.add('hidden');
    }

    // Checklist progress
    const done = s.checklist?.done ?? 0;
    const total = s.checklist?.total ?? 12;
    document.getElementById('checklist-count').textContent = `${done}/${total}`;
    document.getElementById('checklist-fill').style.width = `${total > 0 ? (done / total * 100) : 0}%`;

    // Actions — figees si session terminee
    const actionsEl = document.getElementById('actions-items');
    if (closed) {
      actionsEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Session terminee — aucune action</p>';
    } else if (s.actions?.length) {
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

    const closed = isSessionClosed(state.session);

    document.getElementById('lineup-count').textContent = `${l.confirmed_count ?? 0}/${l.target ?? 10}`;

    // For closed sessions, mark confirmed artists as present and hide declined
    const artistes = closed
      ? (l.artistes || []).filter(a => a.status !== 'declined' && a.status !== 'absent').map(a => ({ ...a, present: true }))
      : (l.artistes || []);

    const list = document.getElementById('lineup-list');
    list.innerHTML = artistes.map(a => artistCard(a, false, closed)).join('');

    const remp = document.getElementById('lineup-remplacants');
    if (l.remplacants?.length) {
      remp.innerHTML = l.remplacants.map(a => artistCard(a, true)).join('');
      remp.classList.remove('hidden');
    } else {
      remp.innerHTML = '';
    }

    // Copy all DM button — hide for closed sessions
    const copyAllBtn = document.getElementById('btn-copy-all-dm');
    if (closed) {
      copyAllBtn.classList.add('hidden');
    } else {
      copyAllBtn.classList.remove('hidden');
      copyAllBtn.onclick = () => {
        const allDm = (l.artistes || []).filter(a => a.dm_text).map(a => a.dm_text).join('\n---\n');
        copyToClipboard(allDm);
      };
    }

    // Individual copy buttons
    list.querySelectorAll('.btn-copy-dm').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.dm);
      });
    });

    // Pointage (tap checkbox to toggle present/absent)
    list.querySelectorAll('.checkin-checkbox[data-checkin]').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePresence(cb.dataset.checkin);
      });
    });
  }

  function artistCard(a, isRemplacant = false, readonly = false) {
    const statusClass = a.present === true ? 'present' : a.present === false ? 'absent' : a.status || 'proposed';
    const statusLabel = a.present === true ? 'Present' : a.present === false ? 'Absent' :
      a.status === 'confirmed' ? 'Confirme' : a.status === 'declined' ? 'Decline' : 'En attente';
    const isChecked = a.present === true;

    return `
      <div class="artist-card" data-artist="${a.name || ''}">
        <div class="checkin-checkbox ${isChecked ? 'checked' : ''} ${readonly ? 'readonly' : ''}" ${readonly ? '' : `data-checkin="${a.name || ''}" title="Marquer present/absent"`}>${isChecked ? '✓' : ''}</div>
        <div class="artist-order">${isRemplacant ? 'R' : a.order || '—'}</div>
        <div class="artist-info">
          <div class="artist-name">
            ${a.name || a.nom_de_scene || '?'}
            ${a.genre === 'F' ? '<span class="badge-genre">F</span>' : ''}
            ${a.is_mc ? '<span class="badge-mc">MC</span>' : ''}
          </div>
          <div class="artist-ig">${a.instagram ? '@' + a.instagram : ''}${a.phone ? ` <a href="tel:${a.phone}" class="artist-phone" onclick="event.stopPropagation()">📞</a>` : ''}</div>
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

    const validSessions = s.sessions?.filter(x => !x.annulee && x.phase !== 'init') || [];
    const last = validSessions.length > 0 ? validSessions[validSessions.length - 1] : null;
    const prev = validSessions.length > 1 ? validSessions[validSessions.length - 2] : null;

    document.getElementById('s-chapeau-last').textContent = last ? `${last.chapeau || 0}€` : '—';
    document.getElementById('s-chapeau-avg').textContent = s.totals?.avg_chapeau ? `${Math.round(s.totals.avg_chapeau)}€` : '—';

    // Trend arrows
    const trendEl = document.getElementById('s-trend');
    if (trendEl && last && prev && prev.spectateurs > 0) {
      const pct = Math.round((last.spectateurs - prev.spectateurs) / prev.spectateurs * 100);
      const arrow = pct >= 0 ? '↑' : '↓';
      const color = pct >= 0 ? 'var(--accent-green)' : 'var(--accent)';
      trendEl.innerHTML = `<span style="color:${color};font-weight:700">${arrow} ${Math.abs(pct)}%</span> frequentation vs precedente`;
      trendEl.classList.remove('hidden');
    } else if (trendEl) {
      trendEl.classList.add('hidden');
    }
    document.getElementById('s-parity-pct').textContent = `${s.totals?.avg_parity || 0}%`;
    document.getElementById('s-parity-fill').style.width = `${s.totals?.avg_parity || 0}%`;
    document.getElementById('s-pool').textContent = s.totals?.total_artistes_uniques ?? '—';
    document.getElementById('s-sessions').textContent = s.totals?.sessions_count ?? '—';
  }

  // ===== RENDER: CHECKLIST =====
  function renderChecklist() {
    const c = state.checklist;
    if (!c?.items) return;

    const closed = isSessionClosed(state.session);
    const isToday = state.session?.j_minus === 0;
    const liveEl = document.getElementById('checklist-live');
    liveEl.classList.toggle('hidden', !isToday && !closed);

    // For closed sessions, mark everything as done
    const items = closed
      ? c.items.map(item => ({ ...item, done: true, timestamp: null }))
      : c.items;

    const sections = { avant: [], show: [], apres: [] };
    items.forEach(item => {
      (sections[item.section] || sections.avant).push(item);
    });

    const sectionLabels = { avant: 'Avant (18h30-19h15)', show: 'Show (19h30-20h25)', apres: 'Apres (20h25-21h00)' };
    const container = document.getElementById('checklist-sections');

    if (closed) {
      container.innerHTML = `<div class="closed-banner">Session terminee — checklist figee</div>` +
        Object.entries(sections).map(([key, sectionItems]) => `
          <div class="checklist-section">
            <h3>${sectionLabels[key] || key}</h3>
            ${sectionItems.map(item => `
              <div class="checklist-item done">
                <div class="checklist-checkbox checked">✓</div>
                <span class="checklist-label">${item.label}</span>
                <span class="checklist-time"></span>
              </div>
            `).join('')}
          </div>
        `).join('');

      // Hide chapeau inputs for closed sessions — show summary instead
      const chapeauSection = document.querySelector('.chapeau-section');
      if (chapeauSection && state.session) {
        const s = state.session;
        const chapeau = state.stats?.sessions?.find(x => x.date === s.date);
        if (chapeau?.chapeau) {
          chapeauSection.innerHTML = `
            <h3>Chapeau</h3>
            <div class="chapeau-result">
              Total : <strong>${chapeau.chapeau}€</strong><br>
              ${chapeau.artistes_count || s.lineup_count || '?'} artistes<br>
              Par artiste : <strong>${s.lineup_count ? Math.round(chapeau.chapeau * 0.9 / s.lineup_count * 100) / 100 : '?'}€</strong>
            </div>
          `;
        }
      }
      return;
    }

    container.innerHTML = Object.entries(sections).map(([key, sectionItems]) => `
      <div class="checklist-section">
        <h3>${sectionLabels[key] || key}</h3>
        ${sectionItems.map(item => `
          <div class="checklist-item ${item.done ? 'done' : ''}" data-item-id="${item.id}">
            <div class="checklist-checkbox ${item.done ? 'checked' : ''}">${item.done ? '✓' : ''}</div>
            <span class="checklist-label">${item.label}</span>
            <span class="checklist-time">${item.timestamp ? new Date(item.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
        `).join('')}
      </div>
    `).join('');

    // Click handlers — only for active sessions
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
    const especesInput = document.getElementById('chapeau-especes');
    const numeriqueInput = document.getElementById('chapeau-numerique');
    const totalDisplay = document.getElementById('chapeau-total-display');
    const nbInput = document.getElementById('chapeau-nb');
    const resultEl = document.getElementById('chapeau-result');

    function calc() {
      const especes = parseFloat(especesInput.value) || 0;
      const numerique = parseFloat(numeriqueInput.value) || 0;
      const total = Math.round((especes + numerique) * 100) / 100;
      const nb = parseInt(nbInput.value) || 0;

      totalDisplay.textContent = `${total} EUR`;

      if (total > 0 && nb > 0) {
        const caisse = Math.round(total * 0.1 * 100) / 100;
        const parArtiste = Math.round((total * 0.9 / nb) * 100) / 100;
        resultEl.innerHTML = `Caisse solidarite : <strong>${caisse}€</strong><br>Par artiste : <strong>${parArtiste}€</strong><br><span style="color:var(--text-muted);font-size:0.8rem">Especes ${especes}€ + Numerique ${numerique}€</span>`;
      } else {
        resultEl.innerHTML = '';
      }
    }

    especesInput.addEventListener('input', calc);
    numeriqueInput.addEventListener('input', calc);
    nbInput.addEventListener('input', calc);

    document.getElementById('btn-save-chapeau').addEventListener('click', async () => {
      const especes = parseFloat(especesInput.value) || 0;
      const numerique = parseFloat(numeriqueInput.value) || 0;
      const total = especes + numerique;
      const nb = parseInt(nbInput.value);
      const date = state.session?.date;
      if (!total || !nb || !date) { toast('Remplir les montants et nombre artistes', 'error'); return; }

      await API.post('/api/chapeau', { date, total, nb_artistes: nb, especes, numerique });
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
