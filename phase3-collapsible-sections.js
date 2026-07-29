(() => {
  const DRAFT_STORAGE_KEY = "archers-frontoffice-draft-capital-collapsed";
  const TRANSACTION_STORAGE_KEY = "archers-frontoffice-transaction-center-collapsed";

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

  function upgradeSection({ section, heading, body, source, storageKey, label }) {
    if (!section || !heading || !body || !source) return false;
    if (section.dataset.collapsibleReady === "true") return true;

    section.classList.add("fo-collapsible-section");

    let actions = heading.querySelector(".fo-section-heading-actions");
    if (!actions) {
      actions = document.createElement("span");
      actions.className = "fo-section-heading-actions";
      source.replaceWith(actions);
      actions.append(source);
    }

    if (!actions.querySelector(".fo-section-chevron")) {
      const chevron = document.createElement("span");
      chevron.className = "fo-section-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "⌄";
      actions.append(chevron);
    }

    heading.classList.add("fo-section-toggle");
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("aria-controls", body.id);
    heading.setAttribute("aria-label", `Expand or collapse ${label}`);

    const toggle = () => {
      const expanded = heading.getAttribute("aria-expanded") === "true";
      setCollapsed(section, heading, body, expanded, storageKey);
    };

    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });

    section.dataset.collapsibleReady = "true";
    setCollapsed(section, heading, body, readCollapsed(storageKey), storageKey, false);
    return true;
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

    let body = document.getElementById("fo-draft-collapsible-body");
    if (!body) {
      body = document.createElement("div");
      body.id = "fo-draft-collapsible-body";
      body.className = "fo-section-body";
      section.insertBefore(body, years);
      body.append(years, rule);
    }

    return upgradeSection({
      section,
      heading,
      body,
      source,
      storageKey: DRAFT_STORAGE_KEY,
      label: "Draft Capital"
    });
  }

  function upgradeTransactionCenter() {
    const section = document.getElementById("fo-transaction-center");
    if (!section) return false;
    return upgradeSection({
      section,
      heading: section.querySelector(".fo-transaction-heading"),
      body: document.getElementById("fo-transaction-collapsible-body"),
      source: document.getElementById("fo-transaction-source"),
      storageKey: TRANSACTION_STORAGE_KEY,
      label: "Transaction Center"
    });
  }

  function coverageValue(sourceId, kind) {
    const text = document.getElementById(sourceId)?.textContent?.trim() ?? "";
    const liveMatch = text.match(/Live resource v(.+)/i);
    if (liveMatch) return { text: `Structured • v${liveMatch[1]}`, kind: "good" };
    if (/checkpoint snapshot/i.test(text)) return { text: "Checkpoint snapshot", kind: "warn" };
    if (/canon events/i.test(text)) return { text, kind: "warn" };
    if (/import pending/i.test(text)) return { text: "Import pending", kind: "warn" };
    if (/unavailable/i.test(text)) return { text: "Unavailable", kind: "bad" };
    return { text: kind === "draft" ? "Checking" : "Loading", kind: "warn" };
  }

  function syncCoverageRow(label, sourceId, kind) {
    const row = [...document.querySelectorAll(".fo-coverage-row")]
      .find((candidate) => candidate.firstElementChild?.textContent?.trim() === label);
    const pill = row?.querySelector(".pill");
    if (!pill) return false;

    const coverage = coverageValue(sourceId, kind);
    const nextClass = `pill ${coverage.kind}`;
    if (pill.className !== nextClass) pill.className = nextClass;
    if (pill.textContent !== coverage.text) pill.textContent = coverage.text;
    return true;
  }

  function syncCoverage() {
    const draftReady = syncCoverageRow("Draft-pick inventory", "fo-draft-source", "draft");
    const transactionReady = syncCoverageRow("Transaction ledger", "fo-transaction-source", "transaction");
    return draftReady && transactionReady;
  }

  function setupCoverageObservers() {
    const coverage = document.getElementById("fo-coverage");
    const draftSource = document.getElementById("fo-draft-source");
    const transactionSource = document.getElementById("fo-transaction-source");
    if (!coverage || !draftSource || !transactionSource) return false;
    if (coverage.dataset.frontOfficeCoverageObserver === "true") return true;

    const sync = () => syncCoverage();
    new MutationObserver(sync).observe(draftSource, { childList: true, characterData: true, subtree: true, attributes: true });
    new MutationObserver(sync).observe(transactionSource, { childList: true, characterData: true, subtree: true, attributes: true });
    new MutationObserver(sync).observe(coverage, { childList: true, subtree: true });
    coverage.dataset.frontOfficeCoverageObserver = "true";
    sync();
    return true;
  }

  function initialize(attempt = 0) {
    const draftReady = upgradeDraftCapital();
    const transactionReady = upgradeTransactionCenter();
    const coverageReady = setupCoverageObservers();
    syncCoverage();

    if ((!draftReady || !transactionReady || !coverageReady) && attempt < 120) {
      setTimeout(() => initialize(attempt + 1), 50);
    }
  }

  window.ArchersCollapsibleSections = { upgradeSection };
  window.addEventListener("DOMContentLoaded", () => initialize());
})();