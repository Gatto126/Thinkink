-- One canonical identity per title. Existing shared content is never discarded.
create function public.clean_topic_title(title_input text)
returns text language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(normalize(title_input, NFKC), '[[:space:]]+', ' ', 'g'));
$$;
revoke all on function public.clean_topic_title(text) from public;
grant execute on function public.clean_topic_title(text) to anon, authenticated, service_role;

alter table public.topics add column normalized_key text
  generated always as (lower(public.clean_topic_title(title))) stored;
alter table public.topics add constraint topics_normalized_key_unique unique (normalized_key);
alter table public.topics add constraint topics_normalized_title_length
  check (char_length(public.clean_topic_title(title)) between 2 and 160);
create index topics_latest on public.topics(created_at desc, id desc);
grant select (normalized_key) on public.topics to anon, authenticated;

create function public.find_topic(title_input text)
returns table(id uuid, title text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select t.id, t.title, t.created_at from public.topics t
  where t.normalized_key = lower(public.clean_topic_title(title_input));
$$;
revoke all on function public.find_topic(text) from public;
grant execute on function public.find_topic(text) to anon, authenticated, service_role;

-- The caller's verified JWT supplies attribution; callers never supply user IDs.
-- Uniqueness makes concurrent requests resolve to the same persistent topic.
create function public.create_topic(title_input text)
returns table(id uuid, title text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to create a topic' using errcode = '42501';
  end if;
  if title_input is null or char_length(title_input) > 1000 or
     char_length(public.clean_topic_title(title_input)) not between 2 and 160 then
    raise exception 'Invalid topic title' using errcode = '22023';
  end if;
  return query
    insert into public.topics as t (title, created_by)
    values (public.clean_topic_title(title_input), auth.uid())
    on conflict (normalized_key) do update set title = t.title
    returning t.id, t.title, t.created_at;
end;
$$;
revoke all on function public.create_topic(text) from public, anon;
grant execute on function public.create_topic(text) to authenticated;
