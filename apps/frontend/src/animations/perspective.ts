// Shared by the React Home and the static Mission enhancement.
export function attachPerspectiveMotion(art: HTMLElement): () => void {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function render() {
    frame = 0;
    if (document.hidden || reducedMotion.matches) return;
    // One motion unit per 400 CSS pixels on every page. Never normalize by
    // document/hero height: adding content must not change the animation.
    const progress = Math.max(0, Math.min(1.5, window.scrollY / 400));
    art.style.setProperty('--perspective-progress', progress.toFixed(4));
  }

  function schedule() {
    if (frame || document.hidden || reducedMotion.matches) return;
    frame = requestAnimationFrame(render);
  }

  function updatePreference() {
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      art.style.removeProperty('--perspective-progress');
    } else {
      schedule();
    }
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pageshow', schedule);
  reducedMotion.addEventListener('change', updatePreference);
  // Set the restored scroll pose before the first paint on either page.
  render();

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('pageshow', schedule);
    reducedMotion.removeEventListener('change', updatePreference);
    art.style.removeProperty('--perspective-progress');
  };
}
