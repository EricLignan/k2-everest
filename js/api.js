/* K2 — API Client */

const API = (() => {
  // Same origin — Pages Functions handle /api/* routes
  const BASE = '';

  function getToken() {
    return localStorage.getItem('k2_token');
  }

  function setToken(token) {
    localStorage.setItem('k2_token', token);
  }

  function clearToken() {
    localStorage.removeItem('k2_token');
  }

  function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch { return false; }
  }

  function getRole() {
    const token = getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1])).role;
    } catch { return null; }
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.noCache) headers['Cache-Control'] = 'no-cache';

    try {
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (res.status === 401) {
        clearToken();
        location.reload();
        return null;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      // Offline? Try cache
      if (!navigator.onLine) {
        const cached = localStorage.getItem(`k2_cache_${path}`);
        if (cached) return JSON.parse(cached);
      }
      throw err;
    }
  }

  // Cache successful GET responses locally for offline
  async function get(path, noCache = false) {
    const data = await request(path, { method: 'GET', noCache });
    if (data) localStorage.setItem(`k2_cache_${path}`, JSON.stringify(data));
    return data;
  }

  async function post(path, body) {
    if (!navigator.onLine) {
      // Queue for later
      const queue = JSON.parse(localStorage.getItem('k2_offline_queue') || '[]');
      queue.push({ path, body, timestamp: new Date().toISOString() });
      localStorage.setItem('k2_offline_queue', JSON.stringify(queue));
      return { ok: true, offline: true };
    }
    return request(path, { method: 'POST', body });
  }

  async function syncOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem('k2_offline_queue') || '[]');
    if (queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      try {
        await request(item.path, { method: 'POST', body: item.body });
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem('k2_offline_queue', JSON.stringify(remaining));
  }

  async function login(pin) {
    const data = await request('/api/auth', { method: 'POST', body: { pin } });
    if (data && data.token) {
      setToken(data.token);
      return data;
    }
    throw new Error(data?.error || 'Echec connexion');
  }

  function logout() {
    clearToken();
    location.reload();
  }

  return { get, post, login, logout, isLoggedIn, getRole, syncOfflineQueue, getToken };
})();
