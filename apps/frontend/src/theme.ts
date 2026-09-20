export type Theme = 'light' | 'dark';
const storageKey = 'thinkink-theme';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function storedPreference(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Theme selection still works when browser storage is unavailable. */
  }
  return null;
}

let preference = storedPreference();

export function readTheme(): Theme {
  return preference ?? (systemTheme.matches ? 'dark' : 'light');
}

function applyTheme(): void {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveTheme(theme: Theme): void {
  preference = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    /* Storage is optional. */
  }
  applyTheme();
}

export function toggleTheme(): void {
  saveTheme(readTheme() === 'dark' ? 'light' : 'dark');
}

applyTheme();
systemTheme.addEventListener('change', () => {
  if (preference === null) applyTheme();
});
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  preference = storedPreference();
  applyTheme();
});
