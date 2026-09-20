# Database tests

Run `npm run db:test` after starting local Supabase and applying migrations. `profiles_rls.test.sql` checks the Auth trigger, owner read/avatar-update access, anonymous denial, cross-user denial, column ownership protection and prohibited direct creation/deletion. Fixtures run in a transaction and are rolled back.

The separate local account browser tests exercise the actual Worker, Auth API and PostgREST with disposable synthetic users. Run `npm run test:e2e:local`; those tests remove only identities they created. CI defines a Docker-backed local account job. No hosted credentials or real user data are required.

`avatar_deletion.test.sql` covers fixed usernames, disallowed profile fields, curated avatar restrictions, deleted account traces, detached attribution and content that remains readable by anonymous readers.

`admin_users.test.sql` covers moderator-only account search and pagination, self-deletion protection, and atomic removal of an account and its topics/comments while retaining unrelated discussions.
