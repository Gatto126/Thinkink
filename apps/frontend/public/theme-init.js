/* global matchMedia, localStorage, document */
// Classic, parser-blocking script: apply the saved choice before either page paints.
// Keep the storage key in sync with src/theme.ts; live updates remain there.
(() => {
  let theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  try {
    const saved = localStorage.getItem('thinkink-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // System appearance still works when storage is unavailable.
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
