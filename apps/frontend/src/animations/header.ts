// Shared by the React app and the static Mission page. The stable spacer keeps
// compaction from moving content; mobile headers follow native overscroll at top.
export function attachHeaderMotion(
  shell: HTMLElement,
  animate = true,
): () => void {
  const header = shell.querySelector<HTMLElement>('.site-header');
  if (!header) return () => {};
  const wordmark = header.querySelector<HTMLElement>('.wordmark');
  const actions = header.querySelector<HTMLElement>('.header-actions');
  const navigation = header.querySelector<HTMLElement>('nav');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const collapseAt = 80;
  const expandAt = 32;
  const duration = 260;
  let frame = 0;
  let target = Number(animate && window.scrollY >= collapseAt);
  let progress = target;
  let from = target;
  let startedAt = 0;
  let appliedProgress = '';
  let geometryDirty = true;
  let pinned: boolean | undefined;

  function setStyle(element: HTMLElement, name: string, value: string) {
    if (element.style.getPropertyValue(name) !== value)
      element.style.setProperty(name, value);
  }

  function render(now: number) {
    frame = 0;
    const scrollY = window.scrollY;
    // At the top, mobile CSS puts the header back in document coordinates so
    // native pull-to-refresh carries it with the page, without JS translations.
    if (pinned !== scrollY > 0) {
      pinned = scrollY > 0;
      shell.toggleAttribute('data-pinned', pinned);
    }
    if (progress !== target) {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - elapsed) ** 3;
      progress = elapsed === 1 ? target : from + (target - from) * eased;
    }

    // Scroll selects a destination, never an intermediate layout. Different
    // thresholds prevent trackpad jitter from repeatedly reversing the motion.
    const distance = animate ? Math.max(0, scrollY) : 0;
    const nextTarget =
      distance >= collapseAt ? 1 : distance <= expandAt ? 0 : target;
    if (nextTarget !== target) {
      from = progress;
      target = nextTarget;
      startedAt = now;
    }
    if (reducedMotion.matches) progress = target;

    const nextProgress = progress.toFixed(4);
    const poseChanged = nextProgress !== appliedProgress;
    if (poseChanged) {
      appliedProgress = nextProgress;
      setStyle(shell, '--header-progress', nextProgress);
      if (navigation && navigation.inert !== progress >= 0.5)
        navigation.inert = progress >= 0.5;
    }
    // Once settled, scrolling must not rewrite styles or force fresh layout.
    if ((poseChanged || geometryDirty) && wordmark && actions && header) {
      geometryDirty = false;
      const width = header.clientWidth;
      const feedWidth = parseFloat(
        getComputedStyle(shell).getPropertyValue('--feed-width'),
      );
      const expandedWidth = Math.min(width, feedWidth + 48);
      const gap = width <= 700 ? 8 : 20;
      const leftBound = wordmark.getBoundingClientRect().right + gap;
      const rightBound = actions.getBoundingClientRect().left - gap;
      const compactWidth = Math.max(
        0,
        Math.min(feedWidth, rightBound - leftBound),
      );
      const compactLeft =
        leftBound + (rightBound - leftBound - compactWidth) / 2;
      const searchWidth =
        expandedWidth + (compactWidth - expandedWidth) * progress;
      const expandedLeft = (width - expandedWidth) / 2;
      const searchLeft = expandedLeft + (compactLeft - expandedLeft) * progress;
      setStyle(shell, '--header-search-width', `${searchWidth}px`);
      setStyle(shell, '--header-search-left', `${searchLeft}px`);
    }
    if (progress !== target) schedule();
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  function invalidateGeometry() {
    geometryDirty = true;
    schedule();
  }
  const observer = new ResizeObserver(() => {
    const height = header.getBoundingClientRect().height;
    setStyle(document.documentElement, '--header-offset', `${height + 16}px`);
    invalidateGeometry();
  });
  observer.observe(header);
  if (wordmark) observer.observe(wordmark);
  if (actions) observer.observe(actions);
  render(performance.now());
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('pageshow', invalidateGeometry);
  window.addEventListener('resize', invalidateGeometry);
  reducedMotion.addEventListener('change', schedule);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('pageshow', invalidateGeometry);
    window.removeEventListener('resize', invalidateGeometry);
    reducedMotion.removeEventListener('change', schedule);
    shell.style.removeProperty('--header-progress');
    shell.style.removeProperty('--header-search-width');
    shell.style.removeProperty('--header-search-left');
    shell.removeAttribute('data-pinned');
    if (navigation) navigation.inert = false;
    document.documentElement.style.removeProperty('--header-offset');
  };
}
