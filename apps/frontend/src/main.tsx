import { Favorites } from './pages/Favorites';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { Topic } from './pages/Topic';
import { NotFound } from './pages/NotFound';
import { Auth } from './pages/Auth';
import { Account } from './pages/Account';
import { Moderation } from './pages/Moderation';
import { SessionLoader } from './auth/SessionLoader';
import './styles.css';

// Commit the shell before the render-blocking entry script releases first paint.
// Subsequent renders keep React's normal scheduling.
const root = createRoot(document.getElementById('root')!);
flushSync(() =>
  root.render(
    <StrictMode>
      <BrowserRouter>
        <SessionLoader />
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/topics/:id" element={<Topic />} />
          <Route path="/login" element={<Auth key="login" mode="login" />} />
          <Route path="/signup" element={<Auth key="signup" mode="signup" />} />
          <Route path="/account" element={<Account />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </StrictMode>,
  ),
);
