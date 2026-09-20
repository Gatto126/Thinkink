-- Moderator membership is provisioned administratively, never through profiles
-- or user-editable auth metadata. Public author identities stay private.
create table public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from public, anon, authenticated;
grant all on public.moderators to service_role;

create function public.is_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.moderators where user_id = (select auth.uid()));
$$;
create function public.can_delete_topic(topic_input uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.topics where id = topic_input
    and auth.uid() is not null and (created_by = auth.uid() or public.is_moderator()));
$$;
create function public.delete_topic(topic_input uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.topics where id = topic_input and auth.uid() is not null
    and (created_by = auth.uid() or public.is_moderator());
  if not found then
    raise exception 'Topic unavailable or deletion not allowed' using errcode = '42501';
  end if;
  -- The comments foreign key cascades in this same transaction.
  return true;
end;
$$;
create function public.moderate_comment(comment_input uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  delete from public.comments where id = comment_input;
  return found;
end;
$$;
create function public.moderation_list(kind_input text, query_input text default '', offset_input integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if kind_input not in ('topics','comments') or kind_input is null
    or query_input is null or char_length(query_input) > 160
    or offset_input is null or offset_input < 0 or offset_input > 100000 then
    raise exception 'Invalid filters' using errcode = '22023';
  end if;
  with entries as (
    select t.id, t.id as topic_id, t.title, null::text as body, t.created_at
    from public.topics t where kind_input = 'topics'
      and strpos(lower(t.title), lower(btrim(query_input))) > 0
    union all
    select c.id, t.id, t.title, c.body, c.created_at
    from public.comments c join public.topics t on t.id = c.topic_id
    where kind_input = 'comments'
      and (strpos(lower(c.body), lower(btrim(query_input))) > 0
        or strpos(lower(t.title), lower(btrim(query_input))) > 0)
  ), page as (
    select * from entries order by created_at desc, id desc limit 51 offset offset_input
  ), visible as (
    select * from page order by created_at desc, id desc limit 50
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',id,'topicId',topic_id,
      'title',title,'body',body,'createdAt',created_at) order by created_at desc,id desc) from visible), '[]'::jsonb),
    'hasMore', (select count(*) > 50 from page)) into result;
  return result;
end;
$$;
revoke all on function public.is_moderator(), public.can_delete_topic(uuid), public.delete_topic(uuid), public.moderate_comment(uuid), public.moderation_list(text,text,integer) from public, anon;
grant execute on function public.is_moderator(), public.can_delete_topic(uuid), public.delete_topic(uuid), public.moderate_comment(uuid), public.moderation_list(text,text,integer) to authenticated;

create function public.owned_topics(offset_input integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if offset_input is null or offset_input < 0 or offset_input > 100000 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  with page as (
    select id,title,created_at from public.topics where created_by = auth.uid()
    order by created_at desc,id desc limit 51 offset offset_input
  ), visible as (
    select * from page order by created_at desc,id desc limit 50
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'topicId',id,'title',title,'body',null,'createdAt',created_at)
    order by created_at desc,id desc) from visible),'[]'::jsonb),
    'hasMore',(select count(*) > 50 from page)) into result;
  return result;
end;
$$;
revoke all on function public.owned_topics(integer) from public, anon;
grant execute on function public.owned_topics(integer) to authenticated;
