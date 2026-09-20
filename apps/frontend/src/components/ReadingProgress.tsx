import { useLayoutEffect, useRef } from 'react';

export function ReadingProgress() {
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    let lastPercent = -1;
    function render() {
      frame = 0;
      const distance =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        distance > 0 ? Math.max(0, Math.min(1, window.scrollY / distance)) : 1;
      element!.style.setProperty('--reading-progress', String(progress));
      const percent = Math.round(progress * 100);
      if (lastPercent !== percent) {
        element!.setAttribute('aria-valuenow', String(percent));
        lastPercent = percent;
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(render);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    observer.observe(document.documentElement);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    render();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
    };
  }, []);
  return (
    <div
      ref={track}
      className="reading-progress"
      role="progressbar"
      aria-label="Page reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
    >
      <span />
    </div>
  );
}
