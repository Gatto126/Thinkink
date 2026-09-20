-- Credentials and private email addresses stay in auth.users.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  bio text not null default '' check (char_length(bio) <= 280),
  created_at timestamptz not null default now()
);
create unique index profiles_username_unique on public.profiles (lower(username));
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, bio) on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy profiles_read_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- A failed profile insert rolls back account creation as well.
create function public.create_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username',
    'member_' || substr(replace(new.id::text, '-', ''), 1, 20)));
  return new;
end;
$$;
revoke execute on function public.create_user_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_user_profile();

-- Preserve any users created locally before application migrations existed.
insert into public.profiles (id, username)
select id, 'member_' || substr(replace(id::text, '-', ''), 1, 20) from auth.users;
