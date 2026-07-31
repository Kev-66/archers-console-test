(() => {
  const existing = window.ArchersApp ?? {};
  const config = Object.freeze({
    appName: "St. Louis Archers Franchise Console",
    appVersion: "4.1.0-squad-planner-v1",
    supabaseUrl: "https://oqbylwlkrabxvpdhugrf.supabase.co",
    supabasePublishableKey: "sb_publishable_z-EjW-S0x7GZH2VREEaXAw_NOOrbH-m",
    franchiseId: "stl-2026",
    season: 2026,
    defaultRoute: "overview",
    storagePrefix: "archers-console"
  });

  function createSupabaseClient(options = {}) {
    if (!window.supabase?.createClient) {
      throw new Error("Supabase client library is not available.");
    }
    return window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        ...options
      }
    );
  }

  function routeTo(routeName, options = {}) {
    const route = String(routeName || config.defaultRoute);
    const button = document.querySelector(`.tab-button[data-tab="${CSS.escape(route)}"]`);
    const panel = document.getElementById(route);
    if (!panel) return false;

    if (button instanceof HTMLElement) {
      button.click();
    } else {
      document.querySelectorAll(".tab-button").forEach((item) => {
        item.classList.toggle("active", item.dataset.tab === route);
      });
      document.querySelectorAll(".tab-panel").forEach((item) => {
        item.classList.toggle("active", item.id === route);
      });
      localStorage.setItem(`${config.storagePrefix}-tab`, route);
      history.replaceState(null, "", `#${route}`);
    }

    if (options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: options.behavior ?? "smooth" });
    }
    return true;
  }

  window.ArchersApp = Object.freeze({
    ...existing,
    config,
    createSupabaseClient,
    routeTo
  });

  window.dispatchEvent(new CustomEvent("archers:config-ready", { detail: config }));
})();
