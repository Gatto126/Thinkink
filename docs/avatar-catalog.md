# Curated avatars and account settings

Users select an avatar from `/api/avatars`. There is no file upload, user-provided URL or Supabase Storage integration. The initial six abstract SVGs are temporary choices that can be replaced by the project's own collection.

## Add an avatar

1. Add the image to `apps/frontend/public/avatars/` with a lowercase, hyphenated filename. Supported file extensions are `.svg`, `.png`, `.webp` and `.jpg`. A square image works best with the circular crop.
2. Create a new timestamped SQL migration in `supabase/migrations/`. Insert an entry in `public.avatar_options` with its stable `id`, accessible `label`, `/avatars/filename` path and `sort_order`.
3. Apply it locally with `npm run db:migrate`, rebuild the frontend and check the account picker and header. Include the image and migration in the same change.

Example migration:

```sql
insert into public.avatar_options (id, label, src, sort_order)
values ('new-perspective', 'New perspective', '/avatars/new-perspective.webp', 7);
```

The database catalogue is the source of truth; browser code does not contain another list of IDs. The Worker validates the selected ID and availability, while the foreign key and RLS policy enforce the same rule for direct database API requests. Normal users have read-only access to the catalogue.

To retire an option, set `available=false` in a forward migration. Keep its image and row so existing selections continue to display; it will no longer be offered for new selections. Do not repurpose an existing ID for an unrelated image.

## Account behavior

New accounts start without a selected avatar and land on `/account`. Saving an available avatar returns to Explore. The circular avatar in the header opens account settings, including from Mission. Subsequent logins with an avatar go straight to Explore. Mission's content remains static HTML; its header has an optional session enhancement.

Home and Mission share the session store. A tab-local `sessionStorage` preview contains only the signed-in appearance and curated avatar, so full-page navigation does not briefly display Sign in. It contains no user ID, username, email or tokens and never grants access: protected pages await the server response. Successful session checks, avatar saves, sign-out and deletion update the preview. With no preview, the header reserves its space until the check completes; storage failures do not prevent sign-in. Mission keeps a Sign in fallback when JavaScript is disabled.

Username and email are displayed as fixed account details. Profile updates accept only `avatarId`. Direct SQL/API updates of username, biography and ownership are denied to authenticated users. Existing biographies are retained in the private profile row but no longer returned by the application API or editable.

## Deletion and shared content

`DELETE /api/auth/account` requires the current session, an allowed Origin, the current password and explicit confirmation. The server uses the authenticated account's email and ID; it does not accept a target user ID. Incorrect passwords preserve the account and current session. Reauthentication tokens never enter browser JavaScript.

Supabase performs a hard deletion. The Auth user and associated identities/sessions, profile, avatar selection and account-linked Auth audit data are removed from the live database. Browser session cookies are cleared. The temporary reauthentication session is revoked if deletion fails. The application has no user file storage.

For self-service deletion from Account settings, the `topics` and `comments` tables retain content: their private account references use `ON DELETE SET NULL`. Topic titles and comment text remain readable to other users and anonymous readers; creator/author IDs are not granted to public callers. Future APIs must display a neutral deleted-account label rather than retaining an old username or avatar. Admin deletion from the moderation dashboard explicitly removes the user’s topics and comments before removing the account, in the same database transaction. Comments by others on those topics are also removed; unrelated content remains.

Shared text remains verbatim, including anything the author wrote in that text. This live-database flow does not rewrite historical backups or infrastructure logs; a hosted retention policy must be defined before publication.

Tests cover catalog restrictions, immutable account details, password and session checks, deletion of only the current synthetic account, and retained readable content. SQL fixtures roll back; browser tests remove only records they created.
