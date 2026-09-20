# Limited beta release and rollback

## Scope

The beta uses the same invited email/password signup as development. An invitation immediately creates and signs in an account; confirmation emails, email recovery and password-change flows are not prerequisites for this beta. Email ownership is therefore not verified. Keep direct Supabase self-signup disabled; the invitation gate is enforced by the backend. An administrator can provision beta accounts in Supabase and assign their verified user UUID in `public.moderators`. The deliberately short-password local fixture remains restricted to localhost and is not exported by deployment.

For the HTTPS beta configure `AUTH_BETA_SIGNUP=true`, `AUTH_LOCAL_SIGNUP=false`, the exact site origin in `AUTH_ALLOWED_ORIGINS`, and a beta invitation secret in `SIGNUP_INVITE_CODE`. Configure hosted `SUPABASE_URL`, publishable and secret keys, and provider secrets on the Worker, outside Git. Do not copy `.dev.vars` to a public artifact. Signup is disabled by default on an unconfigured domain. Set the hosted password policy to match development (currently six characters minimum); the application has no additional client-side password restrictions.

Five new topics per account per calendar day (Europe/Rome) are permitted. Resolving an existing title is free; deleting a topic does not refund the allowance. Search reservation limits now also allow five per account per UTC day, subject to the unchanged global caps (10 searches and 20 AI attempts/day, lifetime 100/200). A topic can therefore remain saved but incomplete if the shared budget is exhausted. Free models, manual retries and the moderator pause switch remain in place. No automatic provider refresh or paid fallback is enabled.

Comments support public reading, authenticated posting, replies, author/moderator deletion, 50-item pages and WebSocket updates through per-topic Durable Objects, with ten-second polling only while the live connection is unavailable. They are plain text, limited to 5,000 characters; duplicate submission IDs are idempotent. Database limits are ten comments/minute and 100/day per account. Deleting a topic cascades to its comments. The Comments section hides all replies by default. The reply count beside Reply expands chronological reply pages downward and collapses them upward in 240 ms, retaining content until the closing motion ends and respecting reduced-motion settings; Reply only opens the inline composer. A notification link opens the targeted reply, and successful posting opens the last reply page. Long comments and replies have Show more/less; the new-comment form follows existing conversations. The overview comment icon shares the live total from the discussion. Home cards show aggregate all-time recorded visits and all comments (including replies) beside the title; Most visited ranks the top three topics by all-time recorded visits. Root comments and thread replies have independent 50-item pages; nested replies keep their exact parent but share a single visual indentation. Existing comments are grouped using their saved parent links. Deleting a parent retains its replies as independent conversations, matching the existing deletion policy.

Visits are deduplicated per calendar day. A visit is submitted after six seconds with the page visible, never on prefetch. The database counts at most one visit per topic/account/day, or per signed browser cookie/day for guests. No IP address is recorded. The first-party HttpOnly reader cookie lasts seven days; only a keyed hash is stored. This is a beta popularity signal, not fraud-proof analytics: clearing cookies or using multiple accounts can inflate it. Guest and signed-in identities are separate. No provider requests are made by comments or visits.

Initial news/AI preparation still runs in the create request, with persisted claims, budgets and saved articles; a disconnected request can leave a recoverable partial topic. For this limited beta recovery remains explicit through Retry preparation. Durable background jobs and automatic news refresh are deferred.

## Before a release

1. Commit the reviewed source and tag the known-good release; use the release commit in the GitHub repository. Run `npm run check`, `npm run build`, `npm run test:rooms`, SQL tests, and browser tests against a preview with `AUTOMATED_TEST_MODE=true`. Never put real provider calls into CI.
2. Export the hosted database to a protected backup and record which migrations are applied. Rehearse restore into a separate database, never reset the live beta database as a release step.
3. Record the current Worker version from `npx wrangler deployments list --config apps/backend/wrangler.jsonc --name <worker-name>`. Save its UUID with the release commit and migration list. Record configuration/secret names and protected recovery references, not secret values in Git.
4. Apply additive migrations in staging, then verify login, invitation signup, posting/deletion, quota, public reading and ranking. Deploy the new Worker/asset bundle only after its required schema exists. Follow the same order for the beta environment.
5. Check `/api/health`, then use existing saved topics for the online smoke test. Verify that provider counters remain unchanged. Use the moderator pause switch if new generation needs to be suspended.

## Roll back application code and assets

Run the wrapper with the exact previously recorded version and Worker name:

```sh
npm run release:rollback -- <previous-version-uuid> <worker-name>
```

The script uses the installed Wrangler and retains its interactive confirmation. It does not guess a version, deploy automatically, reset data or alter secrets. Verify the displayed target before confirming. Check `/api/health`, sign-in and an existing topic afterwards. Cloud account access and a previously deployed version are required; no remote rollback has been executed or claimed tested locally.

Keep additive migrations and newly created user content in place. These beta migrations add tables/functions and preserve old endpoint shapes, so the preceding app version can run against the expanded schema. The five-topic quota remains in force even after rolling back the application. For a faulty database change, pause writes and apply a forward repair migration; do not blindly run destructive down migrations or restore an old backup over newer user content. A point-in-time data restore is a separate recovery action with explicit data-loss assessment.

## Deferred by product decision

Contact/reporting pages and image reuse review are outside this beta implementation. Hosted staging, domain, actual cloud secrets, first deployment and a real remote rollback rehearsal still require the target infrastructure. Local implementation does not mean the site is already published.

Comment likes and topic favorites are persisted per authenticated account. Hearts display a public count and the caller's selected state on roots and replies. PUT writes set an explicit boolean and are idempotent; duplicate requests never add another like. Favorites are private, paged in groups of 20, and reachable through the star in the avatar menu. Removing a topic, comment or account cascades to the relevant saved selections. Favorite stars are available on home and favorites cards as well as topic pages; same-topic instances synchronize immediately after successful writes. Neither selected states nor favorite lists enter the public content cache. Unauthenticated readers can see counts and are directed to sign in to select a heart or star.

Topic responses include visit and comment totals before the first card render. The action row reserves counter widths to prevent loading shifts. Visits/favorite state refresh every 15 seconds while visible; comment/like counts follow live discussion invalidations (ten-second polling is the disconnected fallback). Likes notify the comment/reply author through the existing 15-second visible-page inbox poll, including avatar badge and exact comment links. Self-likes do not notify. One historical event per actor/comment prevents repeated PUTs or unlike/re-like cycles from duplicating notifications or resetting a read event. Events are not backfilled for old likes.

## Topic room deployment

Apply `20260921070000_topic_rooms.sql` before deploying the Worker. Keep the `TOPIC_ROOMS` binding, exported `TopicRoom` class and `v1` SQLite class migration together. Repeat the binding explicitly in each named Wrangler environment. A hosted smoke test must cover two readers, a reconnect, a reply/like, deletion and the room recovery alarm. The local runtime tests are not a substitute for that staging check. Automatic news/AI refresh remains deferred. See [live discussion](realtime.md).
