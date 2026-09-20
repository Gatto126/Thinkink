const revealed = new WeakSet<Element>();

// Content is readable before enhancement and with JavaScript or motion disabled.
export function attachRevealMotion(elements: Iterable<Element>): () => void {
  if (!('IntersectionObserver' in window)) return () => {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set<Animation>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        revealed.add(entry.target);
        if (reducedMotion.matches) continue;
        const animation = entry.target.animate(
          [
            { opacity: 0.45, transform: 'translateY(20px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 600, easing: 'ease-out' },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    },
    { threshold: 0.15 },
  );
  for (const element of elements) {
    if (revealed.has(element)) continue;
    const bounds = element.getBoundingClientRect();
    // Never dim content the visitor can already see when enhancement starts.
    // Only elements initially outside the viewport receive a scroll reveal.
    if (bounds.top < innerHeight && bounds.bottom > 0) revealed.add(element);
    else observer.observe(element);
  }
  function cancelAnimations() {
    if (!reducedMotion.matches) return;
    animations.forEach((animation) => animation.cancel());
    animations.clear();
  }
  reducedMotion.addEventListener('change', cancelAnimations);
  return () => {
    observer.disconnect();
    reducedMotion.removeEventListener('change', cancelAnimations);
    animations.forEach((animation) => animation.cancel());
    animations.clear();
  };
}
