# Live discussion

Each topic has one SQLite-backed Cloudflare `TopicRoom`, selected using its UUID with `idFromName`. The Worker exposes `GET /api/topics/:id/live` as a WebSocket upgrade and forwards it through the `TOPIC_ROOMS` binding. Static assets and the HTTP API keep their existing routes.

## Persistence and delivery

Supabase remains the source of truth. Comments, replies, likes and deletions use the existing authenticated HTTP endpoints and database permissions. PostgreSQL triggers advance `topics.discussion_revision` in the same transaction as the change. Idempotent retries do not create duplicate comments or likes, and rolled-back mutations do not advance the cursor.

After a successful HTTP mutation, the Worker asks the room to read and broadcast the committed revision. A failed notification does not turn a saved comment into a failed write. A ten-second room alarm checks the persisted cursor while readers are connected, recovering the commit-to-broadcast gap, direct administrative changes and account deletion. It stops when the last socket leaves. These alarms never search for news or generate AI content.

The protocol sends only `sync` with a decimal revision string, `presence` with an aggregate reader count, `deleted`, and `pong`. It does not broadcast user IDs, credentials, comment bodies, deletion permissions or private likes/favorites. On each new connection and newer revision, the browser reloads its visible comment pages through the normal authorized API. This is coalescing invalidation with snapshot recovery, not an append-only event replay log. Multiple commits can be represented by one refresh without losing the final database state.

The browser reconnects with bounded exponential backoff and jitter, reloads after returning to a visible tab, and closes its socket on navigation or while hidden. A heartbeat detects half-open connections. Successful live connections replace the regular discussion polling; disconnected clients or failed snapshot reads retain a ten-second visible-page fallback. Loaded pages and comment drafts stay mounted during invalidation. Replies and reaction counts share the same topic connection.

## Presence and boundaries

Anonymous visitors may read the public discussion. Signed-in identity is verified by the Worker before forwarding the upgrade; incoming identity headers are replaced. The exact allowed browser origin and HTTPS (except localhost) are required. Mutations are never accepted over the socket.

Each visible signed-in account counts once across tabs. Socket attachments preserve identity and leases during hibernation. Heartbeats renew a 75-second lease; connections expire after five minutes so reconnecting revalidates authentication. Client session changes reconnect immediately. Only aggregate presence is public. Presence is an approximate operational signal, not an authorization mechanism.

Rooms accept at most 200 simultaneous sockets. Client messages are limited to the small presence schema, at most 256 characters and two per second. Oversized, malformed and write-like messages close the connection. Database request timers are cleared after the full response body is consumed so they do not prevent hibernation.

## Verification

```sh
npm run check
npm run build
npm run test:rooms
npm run db:migrate
npm run db:test
npm run test:e2e:local -- local-realtime.spec.ts
```

Runtime tests use the built Worker in Miniflare with controlled outbound database responses. They exercise actual WebSocket upgrades, topic isolation, duplicate invalidation, presence, hibernation, alarms, reconnect snapshots, deleted topics and invalid messages. SQL tests verify transactional cursors and grants. Desktop/mobile browser tests use local Supabase and the real local Worker, creating and cleaning up only synthetic fixtures. Automated provider calls remain disabled.

## Deployment

Apply migration `20260921070000_topic_rooms.sql` before deploying the Worker. Keep the `TopicRoom` export, `TOPIC_ROOMS` namespace binding and `v1` migration declaring `new_sqlite_classes` together. Repeat the namespace binding in each named Wrangler environment. Each environment must use its own database and namespace.

Verify two independent readers, reconnect recovery, moderation, presence and the recovery alarm over hosted HTTPS before release. Existing database schema remains compatible with the preceding HTTP/polling application. Do not delete or rename an established Durable Object class to roll back application code; follow Cloudflare's class migration rules and verify the target version's bindings. Automatic news/AI refresh and durable content-generation jobs remain future work.

References: [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).
