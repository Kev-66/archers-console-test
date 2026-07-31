(() => {
  const APP = window.ArchersApp;
  if (!APP?.createSupabaseClient) return;

  const client = APP.createSupabaseClient();
  let teamNames = new Map();
  let loading = null;

  const normalize = (value) => String(value ?? "").trim().toLowerCase();

  async function loadDirectory() {
    if (teamNames.size) return teamNames;
    if (loading) return loading;

    loading = client.from("cff_teams")
      .select("team_id, team_name")
      .eq("active", true)
      .then(({ data, error }) => {
        if (error) throw error;
        teamNames = new Map((data ?? []).map((team) => [normalize(team.team_id), team.team_name]));
        return teamNames;
      })
      .finally(() => {
        loading = null;
      });

    return loading;
  }

  function applyLabels() {
    if (!teamNames.size) return;
    document.querySelectorAll("#portal-calendar-list .portal-calendar-title").forEach((target) => {
      const current = target.textContent?.trim() ?? "";
      const match = current.match(/^(vs|at)\s+([a-z0-9._:-]+)$/i);
      if (!match) return;
      const teamName = teamNames.get(normalize(match[2]));
      if (teamName) target.textContent = `${match[1].toLowerCase()} ${teamName}`;
    });
  }

  async function refreshLabels() {
    try {
      await loadDirectory();
      applyLabels();
    } catch (error) {
      console.warn("Portal team labels could not be resolved", error);
    }
  }

  window.addEventListener("archers:portal-rendered", refreshLabels);
  refreshLabels();
})();
