# Implementation plan

Approved direction: 20 September 2026. Project language: English. Development starts locally, followed by a separate remote staging check before publication.

## Product

- **Home:** a topic search, Latest topics, and Most visited. Lists show clickable topic titles only. Latest sorts by creation; Most visited sorts by valid cumulative views.
- **Topic:** an AI overview, its original source snapshot, an independently updated news list, and persistent live discussion.
- **Mission:** the sole static content page, with a product explanation and optional scroll animations. It remains readable without JavaScript or backend services.
- Responsive desktop/mobile layouts and light/dark themes are part of every milestone. On first visit the theme follows the system; the control always offers the opposite theme. A manual choice is saved, with no separate System option in the interface.
- The normal application starts empty. Controlled responses belong exclusively to automated tests or a clearly identified local demo.

## Independent refresh clocks

| Setting             | Initial production value                        |
| ------------------- | ----------------------------------------------- |
| Home revalidation   | 30 seconds while visible                        |
| News refresh        | 5 minutes while readers are present             |
| Summary eligibility | 6 hours since the last successful summary check |
| View qualification  | 5 visible seconds                               |
| View deduplication  | 30 minutes per visitor and topic                |

The first reader of a new topic triggers an initial news acquisition and summary. A reader returning to a stale topic sees saved content while one current refresh starts. Missed intervals are not replayed.

An open, visible topic with a live connection qualifies as a reader even without mouse activity. Anonymous readers also activate refreshes. The public presence counter only shows distinct authenticated readers; multiple tabs for one account count once.

The last reader leaving stops new periodic provider work. An already-started finite job may finish and persist. Visibility reports are operational hints, not authorization to spend without quotas.

Each refresh has separate success, attempt, retry, and running state. A failed summary does not stop news or comments. A failed news check preserves the previous list and its last successful timestamp.

An unchanged input snapshot can reuse the summary. Its generation time stays unchanged; its successful-check time advances. Changed live headlines never replace the frozen sources behind a previous overview.

## Architecture

- **Cloudflare Workers with Static Assets:** one deployable application per environment; static assets and Mission are served directly, API/WebSocket paths enter the Worker.
- **TopicRoom Durable Object:** one stable object per topic; reader connections, next deadlines, durable job claims, alarms, and broadcasts.
- **SQLite within the room:** operational state only, not a duplicate application database.
- **Supabase Postgres:** definitive topic, article, summary, source, comment, event, and statistics storage.
- **Supabase Auth:** email/password accounts. The Worker validates a shared reusable invitation code before administrative account creation; direct public signup is disabled.
- **Serper:** original news URLs and available metadata. Search parameters, result quality, and redistribution/retention conditions must be validated before publication.
- **OpenRouter:** two explicitly evaluated free model variants, a primary and fallback. No automatic paid fallback or model-driven URL creation.

A single room alarm services the earliest deadline across news, summary, reader expiry, recovery, and event delivery. Store multiple deadlines, not multiple assumptions about available alarms. Claims have job identifiers and recoverable expiry. Retried alarms must not duplicate committed results. External calls may have ambiguous outcomes; record attempts and budgets without claiming exactly-once provider execution.

Do not keep the whole room locked while waiting on a provider. Comments must keep working during AI generation. Persist comments and delivery events atomically; only then acknowledge or broadcast. Ordered cursors and replay/snapshot recovery handle the commit-to-broadcast gap.

## Data boundaries

- Topics: stable identity, normalized key, aliases, title, creation and current references.
- Articles/topic articles: original URLs, metadata and the current feed revision.
- Summaries: text, model, input hash, timestamps and status.
- Summary sources: immutable materials actually supplied to that generation.
- Comments: text, topic, optional visible summary reference, single-level reply and idempotency key.
- Private author/alias mappings: stable anonymous alias per topic, never exposed by public API projections.
- Topic events: durable ordered delivery/replay records.
- Views/statistics/provider budgets: deduplicated counters and atomic quota reservations.

Use database uniqueness, indexes, permissions and RLS. Privileged server operations need explicit authorization because privileged keys can bypass RLS. Input article URLs are never accepted as arbitrary server fetch instructions.

## Accounts and scope

Keep email/password login, public usernames, invitation-only signup, no email confirmation, and no password recovery in the first version. An authenticated password change is planned. Do not present email ownership as verified.

Keep public reading and authenticated creation/commenting. Each comment chooses username or an anonymous per-topic alias. No separate chat, private messages, attachments, followers, push notifications, report workflow, complex history browser, or semantic auto-merging is planned.

## Testing

- Inject time into backend domain decisions. Test 5:59:59 versus 6:00:00 instantly.
- Test actual room alarms, eviction, recovery, and concurrent claims with Cloudflare runtime integration tools.
- Playwright clock controls browser timers only. It does not advance the backend clock.
- A local accelerated demo can use controlled news every 15 seconds and summaries every 60 seconds. Never expose forced time or refresh tools in production.
- Validate a limited set of real provider calls separately. Repeated automated tests must not spend provider credits.
- Test visibility changes, abrupt disconnects, last-reader exit, concurrent visitors, independent errors, exhausted global budgets, and replay after reconnection.
- Verify source snapshots remain unchanged as the live feed evolves, and that updates preserve reading position and comment drafts.

## Account milestone status

Local Supabase accounts, invitation-gated test registration, cookie sessions, curated avatar selection, fixed usernames/emails and password-confirmed account deletion are implemented. Topic/comment schema establishes anonymous retention after deletion. The persistent catalogue portion of milestone 2 is implemented: public exact-title lookup, authenticated explicit creation, canonical deduplication, topic retrieval and Latest lists. Initial Serper news and free OpenRouter overview preparation now persists sources and input snapshots, with atomic budgets, bounded fallback and explicit recovery. See [provider limits](content-providers.md). Most visited remains empty until valid view collection exists. Comment composition and periodic content updates remain pending. Owner deletion from account settings and a role-protected topic/comment moderation dashboard are implemented; deleting a topic also deletes its comments atomically. Local automatic email confirmation is restricted to loopback app/database URLs; the staging invitation/email policy remains a release decision. See [local setup](local-setup.md) for reproducible commands and the exact test boundary.

## Topic catalogue and design

The topic page follows the reference's centered, rounded card composition, using the existing feed width, fonts, palette and search header. An overview and live news share the first card; discussion follows beneath it. Sources frozen with an overview remain separate from the live article list. Optional provider image URLs render only when supplied; unavailable images fall back to text. No dates, reader counts, historical editions, or articles are invented. Light/dark themes and reduced-motion-aware scroll reveals use the same implementation as Home and Mission.

`GET /api/topics/search?q=...` returns up to eight matching titles as the visitor types (250 ms debounce, two-character minimum). It ranks full phrases and meaningful words independently of word order, then English/Italian word stems, incomplete words in either direction, and single-character spelling errors for words of at least four characters. There are no topic-specific aliases. Common English/Italian connecting words are ignored for word matching. Exact titles and phrase/prefix matches rank first, followed by the number and specificity of matched words. Wildcard characters remain literal. Predictive scoring currently scans title tokens; a larger catalogue will need an indexed candidate stage and performance measurements. The shared search popover works on Home, Mission and topic pages, follows the compact header, and supports keyboard selection, dismissal and clearing. Superseded requests are aborted and cannot replace newer results. Search errors never offer creation as though the catalogue were empty. `GET /api/topics/resolve?q=...` remains available for exact canonical lookup. Partial and fuzzy suggestions do not block creating a more specific topic: unless the exact normalized title exists, the UI offers an explicit authenticated `POST /api/topics` action. The database normalizes Unicode compatibility, case and whitespace and enforces uniqueness even during concurrent creation. The original display title and creator are preserved on duplicate requests. Public projections exclude creator IDs. `GET /api/home` returns up to 30 latest topics with stable ordering; Most visited is intentionally empty until metrics exist. Suggestions search within titles and are lexical, not a semantic model: arbitrary synonyms and cross-language concepts are not yet recognized. Fuzzy neighbors are never automatically merged. Previous suggestions remain visible during a new request without loading copy; creation requires a completed lookup for the current query.

## Delivery milestones

1. Foundation: product documentation, repository, design, static Mission, frontend shells, shared contracts and time-policy tests.
2. Persistence: local Supabase, schema, access policies, invited accounts and persistent topic catalogue.
3. Real providers: one search producing valid articles and an evaluated summary with frozen sources.
4. Coordinated updates: TopicRoom, active-reader leases, two clocks, quotas, recovery and accelerated tests.
5. Discussion: comments, replies, anonymous projection, WebSockets, presences and replay.
6. Home metrics: valid view collection, Latest/Most visited queries and visible-only revalidation.
7. Local release verification: database rebuild, build preview, concurrency/failure tests, accessibility and consumption measurements.
8. Remote staging: HTTPS, real environment bindings/secrets, model/provider limits and reproducible deployment/recovery before launch.

## Maintenance and operations

The repository uses three npm workspaces: `apps/frontend`, `apps/backend`, and `packages/shared`. Dependencies, TypeScript environments, tests and builds have explicit owners. The root `supabase/` directory independently owns database configuration, migrations and SQL tests. See [architecture](architecture.md) for dependency boundaries and [repository publication](publishing.md) for public-repository preparation.

Use small commits and focused PRs. Require type checking, lint, relevant tests, formatting and production builds. Version migrations and shared API/event contracts; do not rewrite migrations already applied to shared environments.

Wrangler configuration is the source of truth for Cloudflare. Bindings, variables and secrets are environment-specific. Local, staging and production must not share databases or secret values accidentally.

Document actual account limits, measured CPU, duration, provider calls, messages, storage and error behavior. The initial prototype is not a claim of production free-tier capacity. A five-minute interval costs roughly 12 searches per active topic-hour, regardless of reader count.

Database changes need their own recovery strategy: rolling back application code does not reverse schema or data migrations.

## Official references

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Pages guidance and Workers recommendation](https://developers.cloudflare.com/pages/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits)
- [Serper](https://serper.dev/)
