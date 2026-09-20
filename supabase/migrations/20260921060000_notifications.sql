-- Events are created atomically with new comments, once per recipient.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  comment_id uuid not null references public.comments(id) on delete cascade,
  kind text not null check (kind in ('reply', 'topic_comment')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, comment_id)
);
create index notifications_inbox on public.notifications(recipient_id, created_at desc, id desc);
create index notifications_unread on public.notifications(recipient_id) where read_at is null;
create index notifications_comment on public.notifications(comment_id);
create index notifications_actor on public.notifications(actor_id);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

create function public.notify_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent_author uuid; topic_author uuid;
begin
  if new.author_id is null then return new; end if;
  select author_id into parent_author from public.comments where id = new.parent_id;
  select created_by into topic_author from public.topics where id = new.topic_id;
  if parent_author is not null and parent_author <> new.author_id then
    insert into public.notifications(recipient_id, actor_id, comment_id, kind)
    values(parent_author, new.author_id, new.id, 'reply') on conflict do nothing;
  end if;
  if topic_author is not null and topic_author <> new.author_id then
    insert into public.notifications(recipient_id, actor_id, comment_id, kind)
    values(topic_author, new.author_id, new.id, 'topic_comment') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_comment() from public;
create trigger comment_notifications after insert on public.comments
for each row execute function public.notify_comment();

create function public.my_notifications(offset_input integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if offset_input is null or offset_input < 0 or offset_input > 100000 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  with page as (
    select n.* from public.notifications n where n.recipient_id=auth.uid()
    order by n.created_at desc,n.id desc limit 21 offset offset_input
  ), visible as (select * from page order by created_at desc,id desc limit 20)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'kind',n.kind,'createdAt',n.created_at,'read',n.read_at is not null,
      'username',p.username,'avatar',a.src,'topicId',c.topic_id,'topicTitle',t.title,
      'commentId',c.id,'preview',left(c.body,240)
    ) order by n.created_at desc,n.id desc)
    from visible n join public.comments c on c.id=n.comment_id
    join public.topics t on t.id=c.topic_id
    left join public.profiles p on p.id=n.actor_id
    left join public.avatar_options a on a.id=p.avatar_id),'[]'::jsonb),
    'unreadCount',(select count(*) from public.notifications where recipient_id=auth.uid() and read_at is null),
    'hasMore',(select count(*)>20 from page)
  ) into result;
  return result;
end;
$$;

-- A foreign or deleted ID is a harmless no-op; never reveals another inbox.
create function public.read_notifications(notification_input uuid default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  update public.notifications set read_at=now()
  where recipient_id=auth.uid() and read_at is null
    and (notification_input is null or id=notification_input);
  return true;
end;
$$;
revoke all on function public.my_notifications(integer) from public;
revoke all on function public.read_notifications(uuid) from public;
grant execute on function public.my_notifications(integer),public.read_notifications(uuid) to authenticated;

-- Resolve links against the current tree, including roots promoted after deletion.
create function public.comment_location(topic_input uuid, comment_input uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare root_comment public.comments; root_offset integer; reply_offset integer;
begin
  with recursive ancestors as (
    select c.* from public.comments c where c.id=comment_input and c.topic_id=topic_input
    union all
    select c.* from public.comments c join ancestors a on a.parent_id=c.id where c.topic_id=topic_input
  ) select * into root_comment from ancestors where parent_id is null;
  if root_comment.id is null then raise exception 'This comment is no longer available.' using errcode = 'P0002'; end if;
  select (count(*) / 50)*50 into root_offset from public.comments c
    where c.topic_id=topic_input and c.parent_id is null
    and (c.created_at,c.id)>(root_comment.created_at,root_comment.id);
  with recursive replies as (
    select c.* from public.comments c where c.parent_id=root_comment.id
    union all
    select c.* from public.comments c join replies r on c.parent_id=r.id
  ) select (count(*) / 50)*50 into reply_offset from replies r
    join public.comments target on target.id=comment_input
    where (r.created_at,r.id)<(target.created_at,target.id);
  return jsonb_build_object('rootId',root_comment.id,'rootOffset',root_offset,'replyOffset',reply_offset);
end;
$$;
revoke all on function public.comment_location(uuid,uuid) from public;
grant execute on function public.comment_location(uuid,uuid) to anon, authenticated;
