# Thinkink

**Find the context. Follow the news. Join the conversation.**

Thinkink is a shared news-reading application with independently updated AI overviews, original reporting, and persistent live discussion.

A limited beta is live at [thinkink.ansaldi-graphic.workers.dev](https://thinkink.ansaldi-graphic.workers.dev/).

## Current milestone

The React frontend, Cloudflare Worker, static Mission page and local Supabase accounts are connected. You can create an invited test account, sign in, select a curated avatar, return to Explore, reopen account settings from the header, sign out or delete the account after password confirmation. The theme follows the system until explicitly changed; Home and Mission artwork responds to vertical scrolling and respects reduced motion.

The persistent topic catalogue supports live partial-title suggestions, public reading, authenticated creation, canonical title deduplication, and Latest topics. The topic page uses a centered card feed with the shared search header, themes and vertical reveal motion. Creation prepares up to six real Serper news results and a free OpenRouter overview with linked, frozen sources. Content persists across reloads without further provider requests; failures preserve available articles. Atomic spending caps, one bounded free fallback, explicit retries and a moderator pause control protect the demo budget. See [provider setup and consumption](docs/content-providers.md).

Account settings list the user’s own topic cards with confirmed deletion, including associated comments. A role-protected moderation dashboard manages topics, comments and registered users. Admin user deletion removes the account, all its topics (including other users’ comments on those topics) and its comments elsewhere in one transaction. Self-service account deletion retains anonymized shared topics and comments. Persistent comments, replies and daily-deduplicated view counting are implemented; Durable Object rooms deliver discussion updates over hibernating WebSockets; automatic provider scheduling remains deferred; there are no fabricated articles, summaries, history entries or popularity rankings.

## Local development

Requirements: Node.js 22.13+ or 24+ and npm. The initial environment uses Node 22.19.0.

```sh
npm ci
# Start Docker Desktop first to use accounts:
npm run db:start
npm run db:migrate
npm run db:configure
npm run dev
```

Open `http://127.0.0.1:5173`. This command builds the initial static assets, generates Worker types, then starts two independent processes: Vite for the frontend on port 5173 and Wrangler for the backend on port 8787. The frontend proxies HTTP and WebSocket traffic under `/api` to the backend. `/mission/` is a separate HTML entry with complete text before JavaScript runs.

```sh
npm run check
npm run build
npm run test:rooms
npm run test:e2e
npm run preview
```

The browser tests use the installed Google Chrome browser locally and Playwright Chromium in CI. `test:e2e` starts its own production-preview server on port 4173; run it before starting a manual preview on that port. The GitHub Actions workflow defines checks, builds, browser tests and a separate local Supabase account/policy job; it does not deploy. Remote CI execution has not been verified yet.

## Next milestone

1. Verify the invited HTTPS beta flow in hosted staging; see [beta release and rollback](docs/beta-release.md).
2. Verify topic rooms, reconnect recovery and authenticated presence in hosted staging; see [live discussion](docs/realtime.md).
3. Evaluate the consumption budget before implementing automatic news/AI refresh clocks.
4. Prepare deployment/recovery checks.

Docker is required for local accounts. The remaining UI can run without a database, with account controls unavailable. `db:configure` writes local credentials to ignored `apps/backend/.dev.vars`; it refuses to overwrite a hosted Supabase URL. The default local invitation is `thinkink-local`. Use synthetic accounts through `/signup` and inspect Auth users and `public.profiles` in Studio at `http://127.0.0.1:54323`. No emails are sent by the local test flow or the explicitly enabled invited beta flow.

Run `npm run db:test` for SQL access-policy checks and `npm run test:e2e:local` for the browser suite including real local accounts. Account tests create unique synthetic identities and remove only their own records. `npm run db:stop` preserves database contents. None of these commands resets or deploys the database.

See [curated avatars and account deletion](docs/avatar-catalog.md) for catalogue maintenance and the tested data-retention boundary.

## Product timing

| Area        | Production policy                                                          |
| ----------- | -------------------------------------------------------------------------- |
| Home        | Revalidate every 30 seconds while visible; never call news or AI providers |
| Topic news  | Check every 5 minutes while at least one reader is present                 |
| AI overview | Generate initially, then check every 6 hours while a reader is present     |
| Comments    | Persist before acknowledgement and WebSocket distribution                  |
| Mission     | Static HTML with progressive, optional browser animations                  |

These are planned timing policies. Initial topic preparation is implemented; periodic provider refresh remains disabled to conserve the demo budget. Preparation claims and budget reservations use tested database row locks. Room recovery alarms and WebSockets are implemented and covered by runtime tests; those alarms only recover discussion changes and reader leases. They never initiate provider refreshes.

## Repository map

```text
thinkink/
├── apps/
│   ├── frontend/        # React, static Mission, Vite, browser dependencies
│   └── backend/         # Worker, domain logic, Wrangler, server tests
├── packages/
│   └── shared/          # Public API contracts and common constants
├── supabase/            # Database configuration, migrations, SQL tests
├── scripts/             # Local database setup without global shell changes
├── tests/e2e/           # Tests that exercise frontend and backend together
├── docs/                # Architecture, implementation and setup guidance
├── .github/             # CI, dependency updates, pull request template
├── package.json         # Workspace orchestration and common tools
├── package-lock.json    # One lockfile for reproducible installation
└── tsconfig.base.json   # Shared compiler rules; each runtime has its own config
```

Each application has its own `package.json`, dependencies, TypeScript configuration and build command. The root coordinates them with npm workspaces. ESLint rejects imports across frontend/backend boundaries and access to private shared-package files.

The database has its own lifecycle and versioned SQL, using Supabase's standard root layout. It does not need a JavaScript package or a separate Git repository. Only public contracts cross the application boundary; server refresh decisions live in the backend.

Use `npm run dev:frontend`, `dev:backend`, `build:frontend`, and `build:backend` for focused work. The frontend produces `apps/frontend/dist`; the backend produces `apps/backend/dist`. A full build compiles them in that order. `npm run preview` serves both built artifacts locally at `http://127.0.0.1:4173` through Wrangler.

See [the architecture](docs/architecture.md), [implementation plan](docs/implementation-plan.md), [setup guidance](docs/local-setup.md), and [contribution guidelines](CONTRIBUTING.md).

No cloud resources or deployments are created by the development or test commands. The Wrangler configuration serves the deployed Worker on its workers.dev route; hosted preview URLs remain disabled.

## Publication and license

The project is a work in progress. The source repository is [Gatto126/Thinkink](https://github.com/Gatto126/Thinkink). Repository preparation and remaining GitHub settings are documented in [publishing the repository](docs/publishing.md). The license decision is deferred; no project LICENSE file has been added. Package manifests use `private: true` to prevent accidental npm publication; this does not determine GitHub repository visibility.
