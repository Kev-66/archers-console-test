(() => {
  const DRAFT_STORAGE_KEY = "archers-frontoffice-draft-capital-collapsed";

  function readCollapsed(key) {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }

  function writeCollapsed(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Collapsing still works when browser storage is unavailable.
    }
  }

  function setCollapsed(section, heading, body, collapsed, storageKey, persist = true) {
    section.classList.toggle("is-collapsed", collapsed);
    heading.setAttribute("aria-expanded", String(!collapsed));
    body.hidden = collapsed;
    if (persist) writeCollapsed(storageKey, collapsed);
  }

  function upgradeDraftCapital() {
    const section = document.getElementById("fo-draft-capital");
    if (!section) return false;
    if (section.dataset.collapsibleReady === "true") return true;

    const heading = section.querySelector(".fo-draft-heading");
    const years = document.getElementById("fo-draft-years");
    const rule = document.getElementById("fo-draft-rule");
    const source = document.getElementById("fo-draft-source");
    if (!heading || !years || !rule || !source) return false;

    const body = document.createElement("div");
    body.id = "fo-draft-collapsible-body";
    body.className = "fo-section-body";
    section.insertBefore(body, years);
    body.append(years, rule);

    const actions = document.createElement("span");
    actions.className = "fo-section-heading-actions";
    source.replaceWith(actions);
    actions.append(source);

    const chevron = document.createElement("span");
    chevron.className = "fo-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    actions.append(chevron);

    heading.classList.add("fo-section-toggle");
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("aria-controls", body.id);
    heading.setAttribute("aria-label", "Expand or collapse Draft Capital");

    const toggle = () => {
      const expanded = heading.getAttribute("aria-expanded") === "true";
      setCollapsed(section, heading, body, expanded, DRAFT_STORAGE_KEY);
    };

    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });

    section.dataset.collapsibleReady = "true";
    setCollapsed(section, heading, body, readCollapsed(DRAFT_STORAGE_KEY), DRAFT_STORAGE_KEY, false);
    return true;
  }

  function draftCoverageValue() {
    const source = document.getElementById("fo-draft-source");
    const text = source?.textContent?.trim() ?? "";
    const liveMatch = text.match(/Live resource v(.+)/i);
    if (liveMatch) return { text: `Structured • v${liveMatch[1]}`, kind: "good" };
    if (/checkpoint snapshot/i.test(text)) return { text: "Checkpoint snapshot", kind: "warn" };
    if (/unavailable/i.test(text)) return { text: "Unavailable", kind: "bad" };
    return { text: "Checking", kind: "warn" };
  }

  function syncDraftCoverage() {
    const row = [...document.querySelectorAll(".fo-coverage-row")]
      .find((candidate) => candidate.firstElementChild?.textContent?.trim() === "Draft-pick inventory");
    const pill = row?.querySelector(".pill");
    if (!pill) return false;

    const coverage = draftCoverageValue();
    const nextClass = `pill ${coverage.kind}`;
    if (pill.className !== nextClass) pill.className = nextClass;
    if (pill.textContent !== coverage.text) pill.textContent = coverage.text;
    return true;
  }

  function setupCoverageObservers() {
    const source = document.getElementById("fo-draft-source");
    const coverage = document.getElementById("fo-coverage");
    if (!source || !coverage) return false;
    if (coverage.dataset.draftCoverageObserver === "true") return true;

    const sync = () => syncDraftCoverage();
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true, attributes: true });
    new MutationObserver(sync).observe(coverage, { childList: true, subtree: true });
    coverage.dataset.draftCoverageObserver = "true";
    sync();
    return true;
  }

  function initialize(attempt = 0) {
    const upgraded = upgradeDraftCapital();
    const coverageReady = setupCoverageObservers();
    syncDraftCoverage();

    if ((!upgraded || !coverageReady) && attempt < 100) {
      setTimeout(() => initialize(attempt + 1), 50);
    }
  }

  window.addEventListener("DOMContentLoaded", () => initialize());
})();