(function () {
  const STATE_KEY = "pema-pes-turnuvasi-ppt-v1";
  const SUPABASE_GLOBAL_KEY = "pema-pes-supabase-config-v1";

  let pollTimer = null;
  let lastRemoteSignature = "";
  let syncQueue = Promise.resolve();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSupabaseUrl(url) {
    return String(url || "").trim().replace(/\/rest\/v1\/?$/, "");
  }

  function defaultState() {
    return { teams: [], news: [], matches: [], adjustments: [] };
  }

  function isStateEmpty(state) {
    return !(state?.teams?.length || state?.news?.length || state?.matches?.length || state?.adjustments?.length);
  }

  function getConfig() {
    try {
      if (window.PEMA_SUPABASE && window.PEMA_SUPABASE.url && window.PEMA_SUPABASE.anonKey) {
        return {
          ...window.PEMA_SUPABASE,
          url: normalizeSupabaseUrl(window.PEMA_SUPABASE.url),
        };
      }

      const stored = localStorage.getItem(SUPABASE_GLOBAL_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed?.url || !parsed?.anonKey) return null;
      return {
        ...parsed,
        url: normalizeSupabaseUrl(parsed.url),
      };
    } catch {
      return null;
    }
  }

  function hasBackend() {
    const config = getConfig();
    return Boolean(config?.url && config?.anonKey && !String(config.url).includes("YOUR_SUPABASE"));
  }

  function readLocalState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        teams: Array.isArray(parsed.teams) ? parsed.teams : [],
        news: Array.isArray(parsed.news) ? parsed.news : [],
        matches: Array.isArray(parsed.matches) ? parsed.matches : [],
        adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      };
    } catch {
      return defaultState();
    }
  }

  function writeLocalState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event("storage"));
  }

  function tableToRows(state) {
    return {
      teams: (state.teams || []).map((team) => ({
        id: team.id,
        name: team.name,
        created_at: team.createdAt || new Date().toISOString(),
      })),
      news: (state.news || []).map((item) => ({
        id: item.id,
        title: item.title,
        journalist: item.journalist,
        text: item.text,
        created_at: item.createdAt || new Date().toISOString(),
      })),
      matches: (state.matches || []).map((item) => ({
        id: item.id,
        home_team_id: item.homeTeamId,
        away_team_id: item.awayTeamId,
        home_score: Number(item.homeScore) || 0,
        away_score: Number(item.awayScore) || 0,
        created_at: item.createdAt || new Date().toISOString(),
      })),
      adjustments: (state.adjustments || []).map((item) => ({
        id: item.id,
        team_id: item.teamId,
        delta: Number(item.delta) || 0,
        created_at: item.createdAt || new Date().toISOString(),
      })),
    };
  }

  function rowsToState(rows) {
    return {
      teams: (rows.teams || []).map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.created_at || item.createdAt || new Date().toISOString(),
      })),
      news: (rows.news || []).map((item) => ({
        id: item.id,
        title: item.title,
        journalist: item.journalist,
        text: item.text,
        createdAt: item.created_at || item.createdAt || new Date().toISOString(),
      })),
      matches: (rows.matches || []).map((item) => ({
        id: item.id,
        homeTeamId: item.home_team_id || item.homeTeamId,
        awayTeamId: item.away_team_id || item.awayTeamId,
        homeScore: Number(item.home_score ?? item.homeScore) || 0,
        awayScore: Number(item.away_score ?? item.awayScore) || 0,
        createdAt: item.created_at || item.createdAt || new Date().toISOString(),
      })),
      adjustments: (rows.adjustments || []).map((item) => ({
        id: item.id,
        teamId: item.team_id || item.teamId,
        delta: Number(item.delta) || 0,
        createdAt: item.created_at || item.createdAt || new Date().toISOString(),
      })),
    };
  }

  function authHeaders() {
    const config = getConfig();
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
  }

  async function request(path, options = {}) {
    const config = getConfig();
    const response = await fetch(`${config.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase request failed (${response.status}): ${text || response.statusText}`);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function fetchTable(table) {
    return request(`${table}?select=*`);
  }

  async function fetchRemoteState() {
    if (!hasBackend()) return null;

    const [teams, news, matches, adjustments] = await Promise.all([
      fetchTable("teams"),
      fetchTable("news"),
      fetchTable("matches"),
      fetchTable("adjustments"),
    ]);

    return rowsToState({
      teams: teams || [],
      news: news || [],
      matches: matches || [],
      adjustments: adjustments || [],
    });
  }

  async function clearRemoteTable(table) {
    await request(`${table}?id=not.is.null`, {
      method: "DELETE",
    });
  }

  async function insertRemoteRows(table, rows) {
    if (!rows.length) return;
    await request(table, {
      method: "POST",
      body: JSON.stringify(rows),
    });
  }

  async function syncLocalStateToBackend() {
    if (!hasBackend()) return false;

    const localState = readLocalState();
    const remoteState = tableToRows(localState);

    await clearRemoteTable("adjustments");
    await clearRemoteTable("matches");
    await clearRemoteTable("news");
    await clearRemoteTable("teams");

    await insertRemoteRows("teams", remoteState.teams);
    await insertRemoteRows("news", remoteState.news);
    await insertRemoteRows("matches", remoteState.matches);
    await insertRemoteRows("adjustments", remoteState.adjustments);

    const fresh = await fetchRemoteState();
    if (fresh) {
      writeLocalState(fresh);
      lastRemoteSignature = JSON.stringify(fresh);
    }
    return true;
  }

  async function initializeState() {
    const localState = readLocalState();
    if (!hasBackend()) {
      return localState;
    }

    const remoteState = await fetchRemoteState();
    if (!remoteState || isStateEmpty(remoteState)) {
      if (!isStateEmpty(localState)) {
        await syncLocalStateToBackend();
        return readLocalState();
      }

      writeLocalState(defaultState());
      lastRemoteSignature = JSON.stringify(defaultState());
      return defaultState();
    }

    writeLocalState(remoteState);
    lastRemoteSignature = JSON.stringify(remoteState);
    return remoteState;
  }

  async function refreshLocalFromBackend() {
    return initializeState();
  }

  function scheduleRefresh(onChange) {
    syncQueue = syncQueue
      .then(async () => {
        const remoteState = await fetchRemoteState();
        if (!remoteState) return;
        const signature = JSON.stringify(remoteState);
        if (signature !== lastRemoteSignature) {
          lastRemoteSignature = signature;
          writeLocalState(remoteState);
          if (typeof onChange === "function") onChange(remoteState);
        }
      })
      .catch((error) => {
        console.error("Turnuva senkronizasyonu başarısız:", error);
      });

    return syncQueue;
  }

  async function subscribe(onChange) {
    if (!hasBackend()) return () => {};

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    pollTimer = setInterval(() => {
      scheduleRefresh(onChange);
    }, 3500);

    const handleFocus = () => scheduleRefresh(onChange);
    window.addEventListener("focus", handleFocus);

    return async () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      window.removeEventListener("focus", handleFocus);
    };
  }

  window.PemaTurnuvaSync = {
    hasBackend,
    readLocalState,
    writeLocalState,
    refreshLocalFromBackend,
    syncLocalStateToBackend,
    subscribe,
    storeConfig(config) {
      localStorage.setItem(SUPABASE_GLOBAL_KEY, JSON.stringify(config));
    },
    getConfig,
  };
})();
