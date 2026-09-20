-- Rank by the same lifetime visit count shown on topic cards.
create or replace function public.popular_topics()
returns table(id uuid,title text,created_at timestamptz,creator_username text,excerpt text,updated_at timestamptz,visits bigint)
language sql stable security definer set search_path = '' as $$
 select t.id,t.title,t.created_at,p.username,
 coalesce(nullif(btrim(c.summary->'paragraphs'->0->>'text'),''),nullif(btrim(split_part(c.summary->>'text',E'\n\n',1)),'')),
 greatest(t.created_at,c.news_checked_at,(c.summary->>'generatedAt')::timestamptz,(c.summary->>'editedAt')::timestamptz),v.visits
 from (select topic_id,count(*) visits from public.topic_visits group by topic_id) v
 join public.topics t on t.id=v.topic_id left join public.profiles p on p.id=t.created_by
 left join public.topic_content c on c.topic_id=t.id
 order by v.visits desc,t.created_at desc,t.id desc limit 3;
$$;
revoke all on function public.popular_topics() from public;
grant execute on function public.popular_topics() to anon,authenticated;
