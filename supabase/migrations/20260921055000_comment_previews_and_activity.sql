-- First replies travel with the roots, avoiding a separate request per thread.
create or replace function public.topic_comment_threads(topic_input uuid, offset_input integer default 0, thread_input uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if offset_input is null or offset_input < 0 or offset_input > 100000 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  if not exists(select 1 from public.topics where id = topic_input) then
    raise exception 'Topic unavailable' using errcode = 'P0002';
  end if;
  if thread_input is not null and not exists(
    select 1 from public.comments where id = thread_input and topic_id = topic_input and parent_id is null
  ) then
    raise exception 'Conversation unavailable' using errcode = 'P0002';
  end if;
  with recursive tree as (
    select c.id, c.id as root_id from public.comments c
    where c.topic_id = topic_input and c.parent_id is null
      and (thread_input is null or c.id = thread_input)
    union all
    select c.id, t.root_id from public.comments c join tree t on c.parent_id = t.id
    where c.topic_id = topic_input
  ), entries as (
    select c.* from public.comments c join tree t on t.id = c.id
    where (thread_input is null and c.parent_id is null)
       or (thread_input is not null and c.id <> thread_input)
  ), page as (
    select * from entries order by
      case when thread_input is null then created_at end desc,
      case when thread_input is not null then created_at end asc,
      case when thread_input is null then id end desc,
      case when thread_input is not null then id end asc
    limit 51 offset offset_input
  ), visible as (
    select * from page order by
      case when thread_input is null then created_at end desc,
      case when thread_input is not null then created_at end asc,
      case when thread_input is null then id end desc,
      case when thread_input is not null then id end asc
    limit 50
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'body', c.body, 'createdAt', c.created_at,
      'username', p.username, 'avatar', a.src,
      'parentId', c.parent_id,
      'replyTo', case when c.parent_id is null then null else coalesce(pp.username, 'Deleted account') end,
      'replyBody', left(parent.body, 180),
      'firstReply', case when thread_input is null then (
        select jsonb_build_object('id', r.id, 'body', r.body, 'createdAt', r.created_at,
          'username', rp.username, 'avatar', ra.src, 'parentId', r.parent_id,
          'replyTo', coalesce(rpp.username, 'Deleted account'), 'replyBody', left(rc.body,180),
          'canDelete', auth.uid() is not null and (coalesce(r.author_id=auth.uid(),false) or public.is_moderator()))
        from tree rt join public.comments r on r.id=rt.id
        left join public.profiles rp on rp.id=r.author_id
        left join public.avatar_options ra on ra.id=rp.avatar_id
        left join public.comments rc on rc.id=r.parent_id
        left join public.profiles rpp on rpp.id=rc.author_id
        where rt.root_id=c.id and rt.id<>c.id
        order by r.created_at,r.id limit 1
      ) else null end,
      'replyCount', case when thread_input is null then (select count(*) from tree t where t.root_id = c.id and t.id <> c.id) else 0 end,
      'canDelete', auth.uid() is not null and (coalesce(c.author_id = auth.uid(), false) or public.is_moderator())
    ) order by
      case when thread_input is null then c.created_at end desc,
      case when thread_input is not null then c.created_at end asc,
      case when thread_input is null then c.id end desc,
      case when thread_input is not null then c.id end asc
    ) from visible c
    left join public.profiles p on p.id = c.author_id
    left join public.avatar_options a on a.id = p.avatar_id
    left join public.comments parent on parent.id = c.parent_id
    left join public.profiles pp on pp.id = parent.author_id), '[]'::jsonb),
    'hasMore', (select count(*) > 50 from page),
    'total', case when thread_input is null then (select count(*) from public.comments where topic_id = topic_input)
      else (select count(*) from entries) end
  ) into result;
  return result;
end;
$$;
revoke all on function public.topic_comment_threads(uuid,integer,uuid) from public;
grant execute on function public.topic_comment_threads(uuid,integer,uuid) to anon, authenticated;

-- Public aggregate counters only: no visitor identifiers or author IDs.
create function public.topic_activity(topic_inputs uuid[])
returns table(topic_id uuid, visits bigint, comment_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if topic_inputs is null or cardinality(topic_inputs) > 50 then
    raise exception 'Invalid topics' using errcode = '22023';
  end if;
  return query select t.id,
    (select count(*) from public.topic_visits v where v.topic_id=t.id),
    (select count(*) from public.comments c where c.topic_id=t.id)
  from public.topics t where t.id=any(topic_inputs);
end;
$$;
revoke all on function public.topic_activity(uuid[]) from public;
grant execute on function public.topic_activity(uuid[]) to anon, authenticated, service_role;
