create table public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,user_id)
);
create index comment_likes_user on public.comment_likes(user_id);
create table public.topic_favorites (
  topic_id uuid not null references public.topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(topic_id,user_id)
);
create index topic_favorites_user on public.topic_favorites(user_id,created_at desc,topic_id);
alter table public.comment_likes enable row level security;
alter table public.topic_favorites enable row level security;
revoke all on public.comment_likes, public.topic_favorites from anon,authenticated;
grant select on public.comment_likes, public.topic_favorites to authenticated;
create policy own_likes on public.comment_likes for select to authenticated using(user_id=auth.uid());
create policy own_favorites on public.topic_favorites for select to authenticated using(user_id=auth.uid());

create function public.comment_reactions(comment_inputs uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if comment_inputs is null or cardinality(comment_inputs)>100 then raise exception 'Invalid comments' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,
 'likeCount',(select count(*) from public.comment_likes l where l.comment_id=c.id),
 'liked',exists(select 1 from public.comment_likes l where l.comment_id=c.id and l.user_id=auth.uid())))
 from public.comments c where c.id=any(comment_inputs)),'[]'::jsonb);
end; $$;
create function public.set_comment_like(comment_input uuid, liked_input boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if liked_input is null then raise exception 'Invalid like' using errcode='22023'; end if;
 perform 1 from public.comments where id=comment_input for update;
 if not found then raise exception 'Comment unavailable' using errcode='P0002'; end if;
 if liked_input then
   insert into public.comment_likes(comment_id,user_id) values(comment_input,auth.uid()) on conflict do nothing;
 else delete from public.comment_likes where comment_id=comment_input and user_id=auth.uid(); end if;
 return public.comment_reactions(array[comment_input])->0;
end; $$;
create function public.topic_social(topic_input uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.topics where id=topic_input) then raise exception 'Topic unavailable' using errcode='P0002'; end if;
 return jsonb_build_object(
 'visits',(select count(*) from public.topic_visits where topic_id=topic_input),
 'commentCount',(select count(*) from public.comments where topic_id=topic_input),
 'favorite',exists(select 1 from public.topic_favorites where topic_id=topic_input and user_id=auth.uid()));
end; $$;
create function public.set_topic_favorite(topic_input uuid, favorite_input boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if favorite_input is null then raise exception 'Invalid favorite' using errcode='22023'; end if;
 perform 1 from public.topics where id=topic_input for update;
 if not found then raise exception 'Topic unavailable' using errcode='P0002'; end if;
 if favorite_input then
   insert into public.topic_favorites(topic_id,user_id) values(topic_input,auth.uid()) on conflict do nothing;
 else delete from public.topic_favorites where topic_id=topic_input and user_id=auth.uid(); end if;
 return public.topic_social(topic_input);
end; $$;
create function public.my_favorites(offset_input integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if offset_input is null or offset_input<0 or offset_input>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(item order by saved_at desc,id desc) from (
 select f.created_at saved_at,t.id,jsonb_build_object('id',t.id,'title',t.title,'createdAt',t.created_at,
 'creatorUsername',p.username,'excerpt',left(tc.summary->>'text',400),
 'updatedAt',coalesce((tc.summary->>'generatedAt')::timestamptz,t.created_at),
 'visits',(select count(*) from public.topic_visits v where v.topic_id=t.id),
 'commentCount',(select count(*) from public.comments c where c.topic_id=t.id)) item
 from public.topic_favorites f join public.topics t on t.id=f.topic_id
 left join public.profiles p on p.id=t.created_by left join public.topic_content tc on tc.topic_id=t.id
 where f.user_id=auth.uid() order by f.created_at desc,t.id desc limit 20 offset offset_input
 ) page),'[]'::jsonb),
 'hasMore',(select count(*)>offset_input+20 from public.topic_favorites where user_id=auth.uid()));
end; $$;
revoke all on function public.comment_reactions(uuid[]),public.set_comment_like(uuid,boolean),public.topic_social(uuid),public.set_topic_favorite(uuid,boolean),public.my_favorites(integer) from public;
grant execute on function public.comment_reactions(uuid[]),public.topic_social(uuid) to anon,authenticated;
grant execute on function public.set_comment_like(uuid,boolean),public.set_topic_favorite(uuid,boolean),public.my_favorites(integer) to authenticated;
