create table public.avatar_options (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  label text not null check (char_length(label) between 1 and 60),
  src text not null unique check (src ~ '^/avatars/[a-z0-9-]+\.(svg|png|webp|jpg)$'),
  available boolean not null default true,
  sort_order integer not null default 0
);
alter table public.avatar_options enable row level security;
revoke all on public.avatar_options from anon, authenticated;
grant select on public.avatar_options to anon, authenticated;
grant all on public.avatar_options to service_role;
create policy avatar_catalog_read on public.avatar_options for select to anon, authenticated using (true);
insert into public.avatar_options (id,label,src,sort_order) values
  ('iris','Iris','/avatars/iris.svg',1), ('sunrise','Sunrise','/avatars/sunrise.svg',2),
  ('orbit','Orbit','/avatars/orbit.svg',3), ('leaf','Leaf','/avatars/leaf.svg',4),
  ('tide','Tide','/avatars/tide.svg',5), ('spark','Spark','/avatars/spark.svg',6);

alter table public.profiles add column avatar_id text references public.avatar_options(id) on delete restrict;
-- Retain existing bios in storage; they can no longer be edited or exposed by the account API.
revoke update (username,bio) on public.profiles from authenticated;
grant update (avatar_id) on public.profiles to authenticated;
drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and exists (
    select 1 from public.avatar_options a where a.id = avatar_id and a.available
  ));

-- Persistence foundation for the forthcoming topic/comment flows.
-- User deletion removes attribution, never the shared content itself.
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 160),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  author_id uuid references auth.users(id) on delete set null
);
create index topics_creator on public.topics(created_by);
create index comments_author on public.comments(author_id);
create index comments_topic_created on public.comments(topic_id,created_at);
alter table public.topics enable row level security;
alter table public.comments enable row level security;
revoke all on public.topics, public.comments from anon, authenticated;
grant select (id,title,created_at) on public.topics to anon, authenticated;
grant select (id,topic_id,body,created_at) on public.comments to anon, authenticated;
grant all on public.topics, public.comments to service_role;
create policy topics_public_read on public.topics for select to anon, authenticated using (true);
create policy comments_public_read on public.comments for select to anon, authenticated using (true);
-- Public callers cannot read the private creator/author IDs or write content directly.

-- Auth audit payloads are not linked by a foreign key. Remove account-linked
-- identifiers from the live database alongside the hard deletion of the user.
create function public.remove_account_traces()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.refresh_tokens where user_id = old.id::text;
  delete from auth.audit_log_entries
    where payload ->> 'actor_id' = old.id::text
       or payload #>> '{traits,user_id}' = old.id::text
       or (old.email is not null and (
         payload ->> 'actor_username' = old.email
         or payload #>> '{traits,user_email}' = old.email
       ));
  return old;
end;
$$;
revoke execute on function public.remove_account_traces() from public, anon, authenticated;
create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function public.remove_account_traces();
