(() => {
  let observer = null;
  let observedTarget = null;

  function openOpponentRoom() {
    if (window.ArchersOpponentPackage?.open) {
      window.ArchersOpponentPackage.open("overview");
      return;
    }
    document.getElementById("wo-opponent-room")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addButton(target) {
    if (!target || target.querySelector("[data-open-opponent-room]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wo-review-button opponent-open-button";
    button.dataset.openOpponentRoom = "true";
    button.textContent = "Open Full Baltimore Dossier";
    button.addEventListener("click", openOpponentRoom);
    target.append(button);
  }

  function connect() {
    const target = document.getElementById("wo-opponent");
    if (!target) {
      setTimeout(connect, 50);
      return;
    }

    addButton(target);
    if (observedTarget === target) return;
    observer?.disconnect();
    observedTarget = target;
    observer = new MutationObserver(() => addButton(target));
    observer.observe(target, { childList: true, subtree: true });
  }

  window.addEventListener("DOMContentLoaded", connect);
  window.addEventListener("beforeunload", () => observer?.disconnect());
})();
