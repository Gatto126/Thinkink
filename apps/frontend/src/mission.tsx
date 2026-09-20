import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { Header } from './components/Header';
import { SessionLoader } from './auth/SessionLoader';
import { attachPerspectiveMotion } from './animations/perspective';
import { attachRevealMotion } from './animations/reveal';

// Only the header is interactive React UI; Mission's content remains static HTML.
const container = document.getElementById('site-header-root');
if (container) {
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <StrictMode>
        <BrowserRouter>
          <SessionLoader />
          <Header documentNavigation />
        </BrowserRouter>
      </StrictMode>,
    ),
  );
}

const art = document.querySelector<HTMLElement>('.mission-art');
if (art) attachPerspectiveMotion(art);
attachRevealMotion(document.querySelectorAll('.reveal'));
