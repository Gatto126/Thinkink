import { useLayoutEffect, useRef } from 'react';
import { attachPerspectiveMotion } from '../animations/perspective';

export function PerspectiveArt({ className = '' }: { className?: string }) {
  const art = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (art.current) return attachPerspectiveMotion(art.current);
  }, []);

  // Mission keeps equivalent HTML so its artwork also exists without JavaScript.
  return (
    <div
      ref={art}
      className={`perspective-art ${className}`}
      aria-hidden="true"
    >
      <span className="perspective-rings">
        <span className="art-ring ring-a" />
        <span className="art-ring ring-b" />
        <span className="art-ring ring-c" />
      </span>
      <span className="art-center">t.</span>
      <span className="art-caption">A SHARED PERSPECTIVE</span>
    </div>
  );
}
