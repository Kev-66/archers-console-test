(() => {
  const SOURCE_URL = "phase3-decision-queue-v1-adapter.js?v=20260730-1";
  const OLD_ACTIVE_SET = 'const OPEN_STATUSES = new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED", "DEFERRED"]);';
  const NEW_ACTIVE_SET = 'const OPEN_STATUSES = new Set(["OPEN", "READY_FOR_REVIEW", "AWAITING_KEVIN", "BLOCKED"]);';

  async function loadCorrectedAdapter() {
    const response = await fetch(SOURCE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Decision Queue adapter returned ${response.status}`);

    let source = await response.text();
    if (!source.includes(OLD_ACTIVE_SET)) {
      throw new Error("Decision Queue active-status signature was not found.");
    }
    source = source.replace(OLD_ACTIVE_SET, NEW_ACTIVE_SET);

    const startMarker = 'window.addEventListener("DOMContentLoaded", () => {';
    const endMarker = '  });\n})();';
    const startIndex = source.lastIndexOf(startMarker);
    const endIndex = source.lastIndexOf(endMarker);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      source = source.slice(0, startIndex)
        + 'const startDecisionQueue = () => {'
        + source.slice(startIndex + startMarker.length, endIndex)
        + '  };\n  if (document.readyState === "loading") {\n    window.addEventListener("DOMContentLoaded", startDecisionQueue, { once: true });\n  } else {\n    startDecisionQueue();\n  }\n})();';
    }

    const blob = new Blob([source + "\n//# sourceURL=phase3-decision-queue-v1-adapter.active.js"], { type: "text/javascript" });
    const script = document.createElement("script");
    const objectUrl = URL.createObjectURL(blob);
    script.src = objectUrl;
    script.onload = () => URL.revokeObjectURL(objectUrl);
    script.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      console.error("Corrected Decision Queue adapter could not execute.");
    };
    document.head.append(script);
  }

  loadCorrectedAdapter().catch((error) => {
    console.error("Decision Queue compatibility loader failed", error);
    const badge = document.getElementById("wo-queue-source");
    if (badge) {
      badge.className = "pill bad";
      badge.textContent = "Decision Queue loader failed";
      badge.title = String(error?.message ?? error);
    }
  });
})();
