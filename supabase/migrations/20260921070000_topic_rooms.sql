-- A coalescing, transactional change cursor. Clients recover with a fresh
-- authorized snapshot, so no comment bodies or private selections enter rooms.
alter table public.topics add column discussion_revision bigint not null default 0;

create function public.touch_topic_discussion()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name = 'comments' then
    if tg_op = 'DELETE' then target := old.topic_id; else target := new.topic_id; end if;
  else
    select topic_id into target from public.comments
      where id = case when tg_op = 'DELETE' then old.comment_id else new.comment_id end;
  end if;
  update public.topics set discussion_revision = discussion_revision + 1 where id = target;
  return null;
end; $$;
revoke all on function public.touch_topic_discussion() from public, anon, authenticated;
create trigger discussion_changes after insert or update or delete on public.comments
  for each row execute function public.touch_topic_discussion();
create trigger discussion_like_changes after insert or delete on public.comment_likes
  for each row execute function public.touch_topic_discussion();

create function public.topic_room_state(topic_input uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('exists', exists(select 1 from public.topics where id=topic_input),
    'revision', coalesce((select discussion_revision::text from public.topics where id=topic_input),'0'));
$$;
create function public.comment_room_topic(comment_input uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select topic_id from public.comments where id=comment_input;
$$;
revoke all on function public.topic_room_state(uuid), public.comment_room_topic(uuid) from public;
grant execute on function public.topic_room_state(uuid), public.comment_room_topic(uuid) to anon, authenticated;
