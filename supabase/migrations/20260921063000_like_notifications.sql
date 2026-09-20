-- Each new like notifies the comment/reply author, never the actor themselves.
-- Keep one historical event per actor/comment, so unlike/re-like cannot spam
-- an inbox or turn an already-read notification unread again.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('reply','topic_comment','comment_like'));
alter table public.notifications drop constraint notifications_recipient_id_comment_id_key;
create unique index notifications_comment_event on public.notifications(recipient_id,comment_id) where kind in ('reply','topic_comment');
create unique index notifications_like_event on public.notifications(recipient_id,comment_id,actor_id) where kind='comment_like';

create function public.notify_comment_like() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 select author_id into recipient from public.comments where id=new.comment_id;
 if recipient is not null and recipient<>new.user_id then
  insert into public.notifications(recipient_id,actor_id,comment_id,kind)
  values(recipient,new.user_id,new.comment_id,'comment_like') on conflict do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.notify_comment_like() from public,anon,authenticated;
create trigger comment_like_notifications after insert on public.comment_likes
for each row execute function public.notify_comment_like();
