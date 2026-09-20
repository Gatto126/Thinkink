-- Deleted authors remain readable to signed-in participants.
create or replace function public.topic_comments(topic_input uuid, offset_input integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if offset_input<0 or offset_input>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 if not exists(select 1 from public.topics where id=topic_input) then raise exception 'Topic unavailable' using errcode='P0002'; end if;
 with page as (
   select c.*,p.username,a.src as avatar_src, parent.body as parent_body,pp.username as parent_username
   from public.comments c left join public.profiles p on p.id=c.author_id
   left join public.avatar_options a on a.id=p.avatar_id
   left join public.comments parent on parent.id=c.parent_id
   left join public.profiles pp on pp.id=parent.author_id
   where c.topic_id=topic_input order by c.created_at desc,c.id desc limit 51 offset offset_input
 ), visible as (select * from page order by created_at desc,id desc limit 50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'body',body,'createdAt',created_at,'username',username,'avatar',avatar_src,
   'parentId',parent_id,'replyTo',case when parent_id is null then null else coalesce(parent_username,'Deleted account') end,
   'canDelete',auth.uid() is not null and (coalesce(author_id=auth.uid(),false) or public.is_moderator())
 ) order by created_at desc,id desc) from visible),'[]'::jsonb),
 'hasMore',(select count(*)>50 from page),'total',(select count(*) from public.comments where topic_id=topic_input)) into result;
 return result;
end;
$$;
