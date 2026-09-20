# Local setup and testing

## Foundation preview

Use Node 22.13+ or 24+. Run `npm ci`, then `npm run dev`. The foundation does not require a cloud account, database, or API key. Unimplemented catalogue endpoints return a clear 503 rather than fabricated records.

Run installation commands from the repository root so npm links all three workspaces and uses the single lockfile. `npm run dev` starts frontend Vite on port 5173 and backend Wrangler on port 8787, with local-only Worker bindings. It prepares frontend assets and generated Worker types first; stopping the command stops both processes.

For separate terminals, run `npm run build:frontend` once, then `npm run dev:backend` in one terminal and `npm run dev:frontend` in another. Keep backend credentials in `apps/backend/.dev.vars`. Vite forwards `/api` HTTP and WebSocket requests to the backend, so browser code uses relative URLs in every environment.

`npm run build` creates independent frontend and backend outputs. `npm run preview` serves the built artifacts through Wrangler on port 4173. Stop a manual preview before `npm run test:e2e`, which needs that port for its own preview process.

## Docker and Supabase

Docker Desktop is installed on the initial development machine at `/Applications/Docker.app`. Ensure its engine is running before starting Supabase. If `docker` is not on PATH, its bundled CLI is `/Applications/Docker.app/Contents/Resources/bin/docker`. Docker Desktop may expose its socket at `$HOME/.docker/run/docker.sock` rather than `/var/run/docker.sock`.

Supabase CLI is a pinned project development dependency. `supabase/config.toml` is already initialized. The first successful start created the local Postgres, Auth, REST, gateway, metadata and Studio containers. The first application migration creates `public.profiles`, an Auth trigger, uniqueness constraints and owner-only access policies. Local Supabase does not require a hosted Supabase project.

With a running Docker engine and its CLI on PATH:

```sh
npm run db:start
npm run db:migrate
npm run db:configure
npm run db:test
npm run db:status
npm run db:stop
```

The database scripts detect Docker Desktop's bundled CLI and user socket on macOS. Other platforms use Docker from PATH. Existing `DOCKER_HOST` settings are respected; global shell settings are unchanged. `db:stop` preserves local data. `db:migrate` applies pending migrations with `migration up --local`; it does not reset the database.

`db:configure` reads only the running local stack, writes its keys into `apps/backend/.dev.vars` with owner-only permissions, and refuses to overwrite a hosted URL. Restart the Worker after configuration. It preserves a custom invitation code; on first setup the local invitation is `thinkink-local`.

Local endpoints are API `http://127.0.0.1:54321`, Postgres port `54322`, and Studio `http://127.0.0.1:54323`. The status command displays only local API and Studio addresses. Startup output suppresses generated keys; `db:configure` writes them directly into ignored local configuration. Nothing needs to be pasted into chat.

The configuration keeps `auth.enable_signup=false` and `auth.email.enable_signup=true`: email/password login is enabled while direct public signup remains blocked. It disables unused Realtime, Storage, email-testing, analytics and Edge Runtime services. WebSockets will be implemented in Cloudflare Durable Objects. The Worker talks to Auth and PostgREST through the backend-only official Supabase client. Browser code uses same-origin `/api/auth/*` routes.

Do not enable remote bindings for ordinary development or connect local tests to a production database.

## Persistent catalogue

After `npm run db:migrate`, sign in and type at least two characters in the shared search field. Matching topics appear in a popover without pressing Enter. A missing result offers **Start this topic**; creation is an explicit action and requires a valid session. The saved topic appears under Latest topics, survives page reloads and local Worker restarts, and is publicly readable. Case/whitespace variants resolve to the same topic. Missing overview/news are shown honestly until the providers are integrated. Most visited has no invented rankings.

`npm run db:test` covers canonical identity and write permissions. `npm run test:e2e:local` also covers browser creation, public reading, concurrent duplicate requests, and retention after account deletion. These tests remove only their own synthetic records.

## Real news and AI milestone

Prepare accounts for Serper and OpenRouter. Keep the API keys in local backend secrets, never in chat, Git, browser code, screenshots, or test fixtures. Model IDs and budgets will be selected after checking the current account quotas and comparing real outputs.

The `.dev.vars` file belongs in `apps/backend/`, next to `wrangler.jsonc`. Use `db:configure` for local accounts; the example file also lists future provider keys. Blank keys do not enable provider calls in this milestone. Never put backend secrets in variables prefixed with `VITE_`, which are intended for browser code.

## Hosted services

Cloudflare and hosted Supabase projects are needed for staging, after the local flow is verified. The initial milestone does not deploy or enable a public preview.

## First complete user journey

An invited user signs up, searches for a topic, sees valid original articles and an AI overview, then reopens the saved topic. Only after this path is reliable do we enable periodic reader-driven refreshes and live discussion.

## Test accounts from the website

1. Run `npm run build` then `npm run preview`, or use `npm run dev`.
2. Open `/signup`. Enter a synthetic email such as `reader@example.test`, a username (3–30 letters, numbers or underscores), a password of at least 12 characters and invitation `thinkink-local` (or your configured code).
3. The Account page offers the curated avatar collection and shows fixed email/username details. Save an avatar to return to Explore, then use the circular header avatar to reopen settings. Reload, sign out and sign back in to verify persistence. Account deletion requires password re-entry and explicit confirmation.
4. Open local Studio at `http://127.0.0.1:54323`: Auth contains the account and Table Editor → `profiles` contains the application profile. Passwords are managed by Supabase Auth, never stored in the profile table.

For automated verification, stop the manual preview and run `npm run test:e2e:local`. The browser suite verifies local signup, invalid credentials, persistence, refresh without waiting an hour, logout, rejected cross-origin writes and profile isolation. Synthetic credentials are generated per run; account tests disable trace/video/screenshot recording. SQL tests run inside a transaction and roll back their fixtures.

The standard `test:e2e` suite works without Docker; real database tests are explicitly opt-in. No news or AI provider credits are used.

## Authentication boundary and staging work

The Worker creates a new Supabase client per request. Access and refresh tokens live only in HttpOnly, SameSite cookies; HTTPS adds Secure and a `__Host-` prefix. Cookies are host-only, responses are private/no-store, and mutation requests require an allowed Origin. Vite's development origins are explicitly configured by `db:configure`.

`getUser` validates identity with Supabase; an expired or absent access token is refreshed from the refresh cookie. Profile queries use that user's JWT and RLS, not the administrative key. Only a curated `avatarId` can be updated; username and email are fixed in account settings. Email addresses are only returned to the signed-in user. Logout revokes the current refresh session and clears both cookies. As with Supabase JWT sessions generally, already-issued access tokens may remain valid until expiry; immediate revocation checks are not implemented.

`AUTH_LOCAL_SIGNUP=true` permits automatic email confirmation only when both the site and Supabase are loopback hosts. Direct public Supabase signup stays disabled. Staging needs its own database, secrets, allowed origins, invitation/email policy and application rate limits before public registration is enabled. The local invitation and automatic confirmation are not production settings. Password recovery/change and email delivery are outside this local account milestone.

Implementation references: [Supabase local development](https://supabase.com/docs/guides/local-development/cli-workflows), [Auth administration](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [server identity validation](https://supabase.com/docs/reference/javascript/auth-getuser), and [row access policies](https://supabase.com/docs/guides/database/postgres/row-level-security).

The avatar collection and account-deletion retention rules are described in [the avatar catalogue guide](avatar-catalog.md). The shared artwork uses a fixed 400-pixel scroll scale, with stronger translations and rotations; adding page content does not change its speed. Reduced-motion preferences disable these transforms.

## Local administrator and content management

After `npm run db:migrate`, run `npm run db:admin` on the current macOS/Docker Desktop development setup to provision the explicitly requested local fixture: `admin@admin.com`, password `1234`. The script only accepts the local Supabase URL and local signup setting, refuses to replace an existing non-fixture account, and does not run during startup or deployment. Normal signup retains its password policy. The development account carries administrator-controlled metadata that restricts Worker login/session use to local app and database URLs.

Moderator membership lives in `public.moderators`, with no direct access for ordinary accounts. It is assigned through administrative tooling, never from an email match or user-editable profile fields. For staging/production, provision a separate account with a strong password and grant its user ID through trusted database administration; the local fixture is not a deployment credential.

Settings (`/account`) include **Your topics**, with cards, topic links, trash buttons and explicit permanent-deletion confirmation. Lists are paginated in groups of 50. Owners can delete only their own topics, including every associated comment. Self-service account deletion still anonymizes and retains shared content; deleting a topic is a separate explicit action.

Moderators land on `/moderation` after login and can return through **Moderation dashboard** in their account settings. The dashboard searches and pages through all topics and comments. Moderators can delete any topic (cascading to its comments) or a single comment without deleting its topic. The **Users** tab lists registered usernames, emails, registration dates, roles and topic/comment counts, with search and 50-item pages. Confirmed admin deletion removes the Auth account, its topics and every comment on those topics, plus the user’s comments on other topics, atomically. Other users’ content on retained topics remains. Admins cannot delete their own account from this dashboard.

The Worker validates sessions, mutation origins and deletion confirmation. JWT-scoped database functions independently check ownership or current moderator membership and perform atomic deletes. Tests cover role spoofing, cross-user deletion denial, cascade behavior, privacy, origin checks, and real browser flows with disposable accounts. No existing user content is removed by setup or tests.
