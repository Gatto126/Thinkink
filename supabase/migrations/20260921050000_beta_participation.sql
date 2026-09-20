-- Beta limits are enforced inside the database, including direct authenticated RPCs.
create table public.daily_activity (
  user_id uuid references auth.users(id) on delete cascade,
  day date not null,
  topics integer not null default 0,
  comments integer not null default 0,
  primary key(user_id, day)
);
alter table public.daily_activity enable row level security;
revoke all on public.daily_activity from public, anon, authenticated;
grant all on public.daily_activity to service_role;
insert into public.daily_activity(user_id,day,topics)
select created_by,(created_at at time zone 'Europe/Rome')::date,count(*)
from public.topics where created_by is not null group by 1,2;

create or replace function public.create_topic(title_input text)
returns table(id uuid,title text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); today date := (now() at time zone 'Europe/Rome')::date; used integer;
begin
  if actor is null then raise exception 'Sign in to create a topic' using errcode='42501'; end if;
  if title_input is null or char_length(title_input)>1000 or char_length(public.clean_topic_title(title_input)) not between 2 and 160 then
    raise exception 'Invalid topic title' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(public.clean_topic_title(title_input)),0));
  if exists(select 1 from public.topics t where normalized_key=lower(public.clean_topic_title(title_input))) then
    return query select t.id,t.title,t.created_at from public.topics t where normalized_key=lower(public.clean_topic_title(title_input));
    return;
  end if;
  insert into public.daily_activity(user_id,day) values(actor,today) on conflict do nothing;
  select a.topics into used from public.daily_activity a where a.user_id=actor and a.day=today for update;
  if used>=5 then raise exception 'You can create 5 topics per day. Try again after midnight (Europe/Rome).' using errcode='PT429'; end if;
  update public.daily_activity a set topics=a.topics+1 where a.user_id=actor and a.day=today;
  return query insert into public.topics as t(title,created_by) values(public.clean_topic_title(title_input),actor) returning t.id,t.title,t.created_at;
end;
$$;

alter table public.comments add column parent_id uuid references public.comments(id) on delete set null;
grant select(parent_id) on public.comments to anon, authenticated;
create table public.comment_rate (
 user_id uuid references auth.users(id) on delete cascade,
 minute timestamptz not null, count integer not null default 0,
 primary key(user_id,minute)
);
alter table public.comment_rate enable row level security;
revoke all on public.comment_rate from public,anon,authenticated;
grant all on public.comment_rate to service_role;

create function public.add_comment(topic_input uuid, comment_input uuid, body_input text, parent_input uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); today date:=(now() at time zone 'Europe/Rome')::date;
  minute_now timestamptz:=date_trunc('minute',now()); used integer; per_minute integer;
begin
 if actor is null then raise exception 'Sign in to comment' using errcode='42501'; end if;
 if body_input is null or length(btrim(body_input)) not between 1 and 5000 or comment_input is null then raise exception 'Write a comment between 1 and 5000 characters.' using errcode='22023'; end if;
 -- The same submission ID is safe to retry after a dropped response.
 perform pg_advisory_xact_lock(hashtextextended(comment_input::text,1));
 if exists(select 1 from public.comments where id=comment_input) then
   if exists(select 1 from public.comments where id=comment_input and author_id=actor and topic_id=topic_input and body=btrim(body_input) and parent_id is not distinct from parent_input) then return comment_input; end if;
   raise exception 'Submission conflict' using errcode='22023';
 end if;
 perform 1 from public.topics where id=topic_input for key share;
 if not found then raise exception 'Topic unavailable' using errcode='P0002'; end if;
 if parent_input is not null and not exists(select 1 from public.comments where id=parent_input and topic_id=topic_input) then raise exception 'Reply unavailable' using errcode='22023'; end if;
 insert into public.daily_activity(user_id,day) values(actor,today) on conflict do nothing;
 select comments into used from public.daily_activity where user_id=actor and day=today for update;
 insert into public.comment_rate(user_id,minute) values(actor,minute_now) on conflict do nothing;
 select count into per_minute from public.comment_rate where user_id=actor and minute=minute_now for update;
 if used>=100 or per_minute>=10 then raise exception 'Too many comments. Please try again later.' using errcode='PT429'; end if;
 update public.daily_activity set comments=comments+1 where user_id=actor and day=today;
 update public.comment_rate set count=count+1 where user_id=actor and minute=minute_now;
 delete from public.comment_rate where user_id=actor and minute<minute_now-interval '1 hour';
 insert into public.comments(id,topic_id,author_id,body,parent_id) values(comment_input,topic_input,actor,btrim(body_input),parent_input);
 return comment_input;
end;
$$;
create function public.delete_own_comment(comment_input uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.comments where id=comment_input and auth.uid() is not null and (author_id=auth.uid() or public.is_moderator());
 if not found then raise exception 'Comment unavailable or deletion not allowed' using errcode='42501'; end if;
 return true;
end;
$$;
create function public.topic_comments(topic_input uuid, offset_input integer default 0)
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
   'canDelete',auth.uid() is not null and (author_id=auth.uid() or public.is_moderator())
 ) order by created_at desc,id desc) from visible),'[]'::jsonb),
 'hasMore',(select count(*)>50 from page),'total',(select count(*) from public.comments where topic_id=topic_input)) into result;
 return result;
end;
$$;
revoke all on function public.add_comment(uuid,uuid,text,uuid),public.delete_own_comment(uuid),public.topic_comments(uuid,integer) from public,anon,authenticated;
grant execute on function public.add_comment(uuid,uuid,text,uuid),public.delete_own_comment(uuid) to authenticated;
grant execute on function public.topic_comments(uuid,integer) to anon,authenticated;

-- Only backend-validated visits may enter this private, daily-deduplicated ledger.
create table public.topic_visits (
 topic_id uuid references public.topics(id) on delete cascade,
 visitor_hash text not null check(length(visitor_hash)=64),
 day date not null default ((now() at time zone 'Europe/Rome')::date),
 primary key(topic_id,visitor_hash,day)
);
create index topic_visits_day on public.topic_visits(day);
alter table public.topic_visits enable row level security;
revoke all on public.topic_visits from public,anon,authenticated;
grant all on public.topic_visits to service_role;
create function public.record_topic_visit(topic_input uuid,visitor_input text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.topics where id=topic_input) then return false; end if;
 insert into public.topic_visits(topic_id,visitor_hash) values(topic_input,visitor_input) on conflict do nothing;
 return true;
end;
$$;
revoke all on function public.record_topic_visit(uuid,text) from public,anon,authenticated;
grant execute on function public.record_topic_visit(uuid,text) to service_role;
create function public.popular_topics()
returns table(id uuid,title text,created_at timestamptz,creator_username text,excerpt text,updated_at timestamptz,visits bigint)
language sql stable security definer set search_path = '' as $$
 select t.id,t.title,t.created_at,p.username,
 coalesce(nullif(btrim(c.summary->'paragraphs'->0->>'text'),''),nullif(btrim(split_part(c.summary->>'text',E'\n\n',1)),'')),
 greatest(t.created_at,c.news_checked_at,(c.summary->>'generatedAt')::timestamptz,(c.summary->>'editedAt')::timestamptz),v.visits
 from (select topic_id,count(*) visits from public.topic_visits where day>=(now() at time zone 'Europe/Rome')::date-6 group by topic_id) v
 join public.topics t on t.id=v.topic_id left join public.profiles p on p.id=t.created_by
 left join public.topic_content c on c.topic_id=t.id
 order by v.visits desc,t.created_at desc,t.id desc limit 10;
$$;
revoke all on function public.popular_topics() from public;
grant execute on function public.popular_topics() to anon,authenticated;
