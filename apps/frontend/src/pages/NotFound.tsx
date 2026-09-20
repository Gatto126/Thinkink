import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function NotFound() {
  return (
    <main id="main" className="status-page">
      <p className="eyebrow">404 · A DIFFERENT DIRECTION</p>
      <h1>
        Nothing here.
        <br />
        <em>Plenty to explore.</em>
      </h1>
      <Link className="pill-button" to="/">
        Back to explore <ArrowRight size={17} />
      </Link>
    </main>
  );
}
