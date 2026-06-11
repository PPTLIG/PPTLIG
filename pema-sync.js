(function () {
  const STATE_KEY = "pema-pes-turnuvasi-ppt-v1";
  const SUPABASE_GLOBAL_KEY = "pema-pes-supabase-config-v1";
  const TABLES = ["adjustments", "matches", "news", "teams"];

  let clientPromise = null;
  let realtimeChannel = null;
  let refreshQueue = Promise.resolve();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSupabaseUrl(url) {
    return String(url || "").trim().replace(/\/rest\/v1\/?$/, "");
  }

  function defaultState() {
    return { teams: [], news: [], matches: [], adjustments: [] };
  }

  function getConfig() {
    if (window.PEMA_SUPABASE && window.PEMA_SUPABASE.url && window.PEMA_SUPABASE.anonKey) {
      return {
        ...window.PEMA_SUPABASE,
        url: normalizeSupabaseUrl(window.PEMA_SUPABASE.url),
      };
    }

    try {
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

  function toRemoteState(state) {
    const teams = (state.teams || []).map((team) => ({
      id: team.id,
      name: team.name,
      created_at: team.createdAt || new Date().toISOString(),
    }));

    const news = (state.news || []).map((item) => ({
      id: item.id,
      title: item.title,
      journalist: item.journalist,
      text: item.text,
      created_at: item.createdAt || new Date().toISOString(),
    }));

    const matches = (state.matches || []).map((item) => ({
      id: item.id,
      home_team_id: item.homeTeamId,
      away_team_id: item.awayTeamId,
      home_score: Number(item.homeScore) || 0,
      away_score: Number(item.awayScore) || 0,
      created_at: item.createdAt || new Date().toISOString(),
    }));

    const adjustments = (state.adjustments || []).map((item) => ({
      id: item.id,
      team_id: item.teamId,
      delta: Number(item.delta) || 0,
      created_at: item.createdAt || new Date().toISOString(),
    }));

    return { teams, news, matches, adjustments };
  }

  function fromRemoteRows(rows) {
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

  async function loadClient() {
    if (!hasBackend()) return null;
    if (!clientPromise) {
      clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) => {
        const config = getConfig();
        return createClient(config.url, config.anonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
      });
    }

    return clientPromise;
  }

  async function fetchRemoteState() {
    const client = await loadClient();
    if (!client) return null;

    const [teams, news, matches, adjustments] = await Promise.all([
      client.from("teams").select("*"),
      client.from("news").select("*"),
      client.from("matches").select("*"),
      client.from("adjustments").select("*"),
    ]);

    if (teams.error || news.error || matches.error || adjustments.error) {
      throw teams.error || news.error || matches.error || adjustments.error;
    }

    return fromRemoteRows({
      teams: teams.data || [],
      news: news.data || [],
      matches: matches.data || [],
      adjustments: adjustments.data || [],
    });
  }

  async function refreshLocalFromBackend() {
    const remote = await fetchRemoteState();
    if (remote) {
      writeLocalState(remote);
    }
    return remote;
  }

  async function replaceRemoteTable(client, tableName, rows) {
    await client.from(tableName).delete().not("id", "is", null);
    if (rows.length) {
      const { error } = await client.from(tableName).insert(rows);
      if (error) throw error;
    }
  }

  async function syncLocalStateToBackend() {
    const client = await loadClient();
    if (!client) return false;

    const localState = readLocalState();
    const remoteState = toRemoteState(localState);

    await replaceRemoteTable(client, "teams", remoteState.teams);
    await replaceRemoteTable(client, "news", remoteState.news);
    await replaceRemoteTable(client, "matches", remoteState.matches);
    await replaceRemoteTable(client, "adjustments", remoteState.adjustments);

    await refreshLocalFromBackend();
    return true;
  }

  function scheduleRefresh(onChange) {
    refreshQueue = refreshQueue
      .then(() => refreshLocalFromBackend())
      .then(() => {
        if (typeof onChange === "function") onChange();
      })
      .catch((error) => {
        console.error("Turnuva senkronizasyonu başarısız:", error);
      });

    return refreshQueue;
  }

  async function subscribe(onChange) {
    const client = await loadClient();
    if (!client) return () => {};

    if (realtimeChannel) {
      await client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    realtimeChannel = client
      .channel("pema-pes-turnuva-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => scheduleRefresh(onChange))
      .on("postgres_changes", { event: "*", schema: "public", table: "news" }, () => scheduleRefresh(onChange))
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => scheduleRefresh(onChange))
      .on("postgres_changes", { event: "*", schema: "public", table: "adjustments" }, () => scheduleRefresh(onChange))
      .subscribe();

    return async () => {
      if (!realtimeChannel) return;
      await client.removeChannel(realtimeChannel);
      realtimeChannel = null;
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
