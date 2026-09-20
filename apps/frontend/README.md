# Frontend

`@thinkink/frontend` owns the browser application: React pages and components, styles, themes, the static Mission HTML, and public assets.

- `src/pages/`: route-level UI.
- `src/components/`: reusable UI components. `Header` owns navigation, account, theme, search and scroll compaction on every page, including Mission.
- `src/auth/SessionLoader.tsx`: shared session initialization and refresh for both entry points.
- `src/api.ts`: HTTP requests and validation of public API responses.
- `mission/index.html`: complete static content, progressively enhanced by `src/mission.tsx`.
- `vite.config.ts`: frontend compilation and the local HTTP/WebSocket proxy.
- `dist/`: generated static assets; ignored by Git.

From the repository root:

```sh
npm run dev:frontend
npm run build:frontend
npm run typecheck --workspace @thinkink/frontend
```

Vite serves the frontend at `http://127.0.0.1:5173` and forwards `/api` requests and WebSocket upgrades to the local Worker on port 8787. Start the backend in another terminal or use root `npm run dev` to run both.

Import shared contracts through `@thinkink/shared/contracts`. Do not import backend files, database clients, secrets or Node.js APIs into browser code. ESLint enforces these boundaries. Build tools have their own Node TypeScript configuration, separate from the browser configuration.

Mission mounts the shared header as a React island. Header links and search results use document navigation there, so leaving Mission loads the destination application instead of replacing only its URL. The main Mission content and a basic navigation fallback remain available without JavaScript.
