(() => {
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.("[data-dq-review]");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    button.click();
  }, true);
})();
