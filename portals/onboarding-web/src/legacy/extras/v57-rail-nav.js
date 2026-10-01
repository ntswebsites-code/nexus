/**
 * Makes the four onboarding step tabs clickable.
 * Going back is always allowed; going forward validates each skipped step.
 */
(function () {
  const rail = document.getElementById('rail');
  if (!rail) return;

  rail.querySelectorAll('[data-step]').forEach((btn) => {
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      const target = Number(btn.getAttribute('data-step'));
      if (!Number.isFinite(target) || target === step) return;
      if (target < step) {
        saveDraft(false);
        step = target;
        render();
        return;
      }
      while (step < target) {
        if (!validCurrent()) return;
        saveDraft(false);
        step += 1;
        render();
      }
    });
  });

  const style = document.createElement('style');
  style.textContent =
    '.rail button[data-step]:hover{background:rgba(49,88,232,.06)}' +
    '.rail button[data-step]{cursor:pointer}';
  document.head.appendChild(style);
})();
